import OpenAI from 'openai';
import axios from 'axios';
import sharp from 'sharp';
import { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { ChatbotRuntimeConfig } from './config';

/**
 * 本地 token 估算（API usage 缺失时的 fallback）：
 * CJK 按 ~0.9 token/字，其它按 ~4 字符/token。
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    let cjk = 0;
    let other = 0;
    for (const ch of text) {
        if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(ch)) cjk++;
        else other++;
    }
    return Math.ceil(cjk * 0.9 + other / 4);
}

/** 从模型输出中提取第一个 JSON 对象（兼容代码块/前后缀） */
export function extractJson(text: string): unknown {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

export interface ChatUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface ChatResult {
    content: string;
    usage?: ChatUsage;
}

function parseUsage(u: unknown): ChatUsage | undefined {
    const o = u as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    if (!o || typeof o !== 'object') return undefined;
    return {
        promptTokens: Number(o.prompt_tokens) || 0,
        completionTokens: Number(o.completion_tokens) || 0,
        totalTokens: Number(o.total_tokens) || 0,
    };
}

/** 对话文本（OpenAI 兼容）；token 估算优先 API usage */
export async function chatCompletion(
    messages: ChatCompletionMessageParam[],
    cfg: ChatbotRuntimeConfig,
    jsonMode = false,
): Promise<ChatResult> {
    const apiKey = cfg.apiKey;
    if (!apiKey) throw new Error('chatbot: 对话 apiKey 未配置（ai.json chatbot.apiKey）');
    const openai = new OpenAI({ apiKey, baseURL: cfg.baseURL });
    const completion = await openai.chat.completions.create({
        model: cfg.chatModel,
        messages,
        max_tokens: 600,
        temperature: 0.9,
        ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    });
    return {
        content: completion.choices?.[0]?.message?.content || '',
        usage: parseUsage(completion.usage),
    };
}

/**
 * 对话文本 + MCP 工具调用（原生 function calling）。
 * 模型请求工具 → 执行（onToolCall）→ 以 role:'tool' 回填 → 循环，最多 maxToolRounds 轮；
 * 轮次耗尽后不带 tools 收尾一次，强制模型给出最终回复。
 */
export async function chatCompletionWithTools(
    messages: ChatCompletionMessageParam[],
    cfg: ChatbotRuntimeConfig,
    tools: ChatCompletionTool[],
    onToolCall: (fullName: string, argsText: string) => Promise<string>,
): Promise<ChatResult> {
    const apiKey = cfg.apiKey;
    if (!apiKey) throw new Error('chatbot: 对话 apiKey 未配置（ai.json chatbot.apiKey）');
    const openai = new OpenAI({ apiKey, baseURL: cfg.baseURL });
    const msgs: ChatCompletionMessageParam[] = [...messages];
    for (let round = 0; round <= cfg.maxToolRounds; round++) {
        const completion = await openai.chat.completions.create({
            model: cfg.chatModel,
            messages: msgs,
            tools,
            tool_choice: 'auto',
            max_tokens: 600,
            temperature: 0.9,
        });
        const m = completion.choices?.[0]?.message;
        if (!m?.tool_calls?.length) {
            return { content: m?.content || '', usage: parseUsage(completion.usage) };
        }
        msgs.push(m as ChatCompletionMessageParam);
        for (const tc of m.tool_calls) {
            if (tc.type !== 'function' || !tc.function) continue; // 只处理 function 工具
            const argsText =
                typeof tc.function.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments || {});
            let result: string;
            try {
                result = await onToolCall(tc.function.name, argsText);
            } catch (err) {
                result = `工具调用异常: ${err instanceof Error ? err.message : String(err)}`;
            }
            msgs.push({ role: 'tool', tool_call_id: tc.id, content: result.slice(0, 2000) });
        }
    }
    const final = await openai.chat.completions.create({
        model: cfg.chatModel,
        messages: msgs,
        max_tokens: 600,
        temperature: 0.9,
        response_format: { type: 'json_object' },
    });
    return {
        content: final.choices?.[0]?.message?.content || '',
        usage: parseUsage(final.usage),
    };
}

/** 压缩任务：dpsk 生成群聊记忆摘要 */
export async function summarizeTranscript(
    groupOpenid: string,
    transcript: string,
    cfg: ChatbotRuntimeConfig,
): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
        {
            role: 'system',
            content:
                '你是群聊记忆压缩助手。把以下 QQ 群聊记录压缩成不超过 300 字的中文摘要，保留关键人物、话题、情绪、梗和图片描述，按时间顺序组织。只输出摘要正文，不要解释。',
        },
        {
            role: 'user',
            content: `群 openid: ${groupOpenid}\n\n聊天记录：\n${transcript.slice(0, 30000)}`,
        },
    ];
    const res = await chatCompletion(messages, cfg);
    return res.content.trim();
}

export interface VisionInputImage {
    buffer: Buffer;
    mime: string;
    ext: string;
    width?: number;
    height?: number;
}

export interface VisionResult {
    summary: string;
    /**
     * 全部短标签（兼容旧逻辑 / 设置页展示）。
     * 由 emotion + style + scene + content + subject 等合并去重。
     */
    tags: string[];
    /** 情感/情绪标签（委屈/撒娇/可怜…）；语义选图仅用此类 */
    emotionTags: string[];
    /** 形式/画风标签（Q版/表情包/动图…）；入库保留，选图不计分 */
    styleTags: string[];
    /** 场景/背景标签（雪地/床边/绿幕…） */
    sceneTags: string[];
    /** 内容标签（动作、OCR 文案、梗文本…） */
    contentTags: string[];
    /** 主体标签（角色名、外貌特征、物种…） */
    subjectTags: string[];
    nsfwRisk: 'low' | 'mid' | 'high';
    /** 是否为表情包（视觉模型 is_meme 判定；供图库入库决策与选图偏好） */
    isMeme: boolean;
}

function toVisionDataUrl(img: VisionInputImage): Promise<string> {
    let buf = img.buffer;
    let mime = img.mime || 'image/png';
    const needResize = (img.width || 0) > 1024 || (img.height || 0) > 1024;
    if (img.ext === 'gif' || mime === 'image/gif' || needResize) {
        return sharp(img.buffer, { animated: false })
            .rotate()
            .resize({ width: 1024, height: 1024, fit: 'inside' })
            .png()
            .toBuffer()
            .then((b) => `data:image/png;base64,${b.toString('base64')}`)
            .catch(() => `data:${mime};base64,${buf.toString('base64')}`);
    }
    return Promise.resolve(`data:${mime};base64,${buf.toString('base64')}`);
}

/** is_meme 判定准则：供图库入库；聊天记录/App 截图等必须 false */
const VISION_MEME_RULES = [
    'is_meme 判定（严格）：',
    'true=适合在群聊快速发送的表情包/反应图/梗图：主体单一、画面简洁、常带夸张表情或短文案，边长通常不大。',
    'false=以下一律 false：聊天记录/会话长截图（多条气泡、头像列表、时间戳）；微信/QQ/Telegram 等 IM 界面；',
    '手机/电脑 App 界面截图（状态栏、导航栏、底部 Tab、设置页、浏览器、相册、游戏全屏 UI、文档表格）；',
    '实拍照片、风景/合影、海报长图、多页拼图、二维码为主的图。',
    '拿不准时 is_meme=false。',
].join('');

/**
 * 标签分类准则：情感 / 形式 / 场景 / 内容 / 主体 必须拆开。
 * 例：["委屈","撒娇","妈妈","白发","Q版","表情包","可怜","探头"]
 * → emotion=["委屈","撒娇","可怜"]；style=["Q版","表情包"]；subject=["妈妈","白发"]；content=["探头"]
 */
const VISION_TAG_RULES = [
    '标签分类（必须拆开，勿混写；各类勿重复）：',
    'emotion_tags：仅情感/情绪/态度（委屈、撒娇、可怜、开心、生气、无语、害羞、宠溺、得意、震惊…），2～6 个。',
    'style_tags：仅画风/形式/媒介（Q版、表情包、动图、静图、梗图、贴纸、二次元、卡通、插画、三视图、3D…），0～4 个。',
    'scene_tags：仅场景/背景/环境（雪地、床边、长椅、绿幕、室内、教室、海边…），0～3 个；无则 []。',
    'content_tags：动作/姿态/OCR文案/梗文本（探头、捂脸、抱着、张嘴、配文原句…），0～5 个。',
    'subject_tags：主体对象（角色名、外貌、物种：白发、粉发、兔耳、猫、熊猫头…），0～5 个。',
    '「表情包」「Q版」「动图」等一律放 style_tags；禁止把形式词放进 emotion/content/subject。',
].join('');

/** 已知形式/元标签：vision 漏分时兜底，且选图 query 会过滤这些词 */
export const STICKER_STYLE_META_TAGS = new Set(
    [
        'q版',
        'q 版',
        '表情包',
        '表情',
        '动图',
        '静图',
        '梗图',
        '反应图',
        '贴纸',
        'meme',
        'sticker',
        'gif',
        'webp',
        '卡通',
        '动漫',
        '二次元',
        '插画',
        '三视图',
        '立绘',
        '头像',
        '像素',
        '简笔画',
        '手绘',
        '截图',
        '拼图',
        '表情贴纸',
        '动画表情',
        '3d',
        '动画截图',
        '实拍',
        '低画质',
        '漫画',
    ].map((s) => s.toLowerCase()),
);

/** 场景/背景关键词（旧数据回退分类） */
export const STICKER_SCENE_HINTS = new Set(
    [
        '雪地',
        '床边',
        '床上',
        '长椅',
        '绿幕',
        '室内',
        '室外',
        '教室',
        '教室里',
        '海边',
        '沙滩',
        '街道',
        '马路',
        '厨房',
        '浴室',
        '厕所',
        '办公室',
        '工位',
        '公园',
        '草地',
        '森林',
        '夜空',
        '星空',
        '教室外',
        '天台',
        '阳台',
        '窗边',
        '桌前',
        '餐桌',
        '沙发',
        '地板',
        '舞台',
        '直播间',
        '屏幕前',
        '黑板',
        '背景',
        '纯色背景',
        '白底',
        '黑底',
        '虚化背景',
    ].map((s) => s.toLowerCase()),
);

/** 内容/动作/文案关键词（旧数据回退；长文案、OCR 另判） */
export const STICKER_CONTENT_HINTS = new Set(
    [
        '探头',
        '捂脸',
        '抱着',
        '拥抱',
        '张嘴',
        '闭眼',
        '举手',
        '摊手',
        '指着',
        '指人',
        '比心',
        '挥手',
        '鞠躬',
        '趴着',
        '躺',
        '蹲下',
        '低头',
        '仰头',
        '扶额',
        '翻白眼',
        '吐舌头',
        '流泪',
        '流汗',
        '泪眼',
        '瞪眼',
        '伸爪',
        '拿刀',
        '叼刀',
        '数钱',
        '吃饭',
        '睡觉',
        '走路',
        '奔跑',
        '消散',
        '破碎',
        '配文',
        '字幕',
        '文字',
        '文字梗',
        '拟声词',
        '说话',
        '喊话',
        '举牌',
        '开门',
        '突击检查',
        '暗中观察',
        '摸头',
        '对戳手指',
        '托腮',
        '双手合十',
        '双手抱头',
        '双手握拳',
        '抱胸',
        '掀被子',
        '起床',
    ].map((s) => s.toLowerCase()),
);

/** 常见情感词：旧数据无 emotionTags 时从 tags 回退抽取（≥2 字，避免单字误伤） */
export const STICKER_EMOTION_HINTS = new Set(
    [
        // 基础情绪
        '委屈',
        '撒娇',
        '可怜',
        '开心',
        '高兴',
        '快乐',
        '生气',
        '愤怒',
        '无语',
        '尴尬',
        '害羞',
        '脸红',
        '宠溺',
        '得意',
        '震惊',
        '吃惊',
        '惊讶',
        '哭泣',
        '流泪',
        '大笑',
        '坏笑',
        '偷笑',
        '微笑',
        '假笑',
        '冷笑',
        '苦笑',
        '傻笑',
        '奸笑',
        '冷漠',
        '嫌弃',
        '鄙视',
        '无奈',
        '郁闷',
        '难过',
        '伤心',
        '悲伤',
        '恐惧',
        '害怕',
        '紧张',
        '焦虑',
        '疲惫',
        '困倦',
        '傲娇',
        '温柔',
        '关心',
        '安慰',
        '鼓励',
        '加油',
        '爱你',
        '比心',
        '心动',
        '喜欢',
        '讨厌',
        '翻白眼',
        '卖萌',
        '可爱',
        '裂开',
        '破防',
        '破大防',
        '社死',
        '疑惑',
        '困惑',
        '沉思',
        '骄傲',
        '自信',
        '慌张',
        '着急',
        '期待',
        '兴奋',
        '激动',
        '感动',
        '抱抱',
        '呜呜',
        '嘤嘤',
        '委屈巴巴',
        '可怜巴巴',
        '气鼓鼓',
        '气呼呼',
        '石化',
        '呆滞',
        '懵逼',
        '崩溃',
        '绝望',
        '认命',
        '躺平',
        '摆烂',
        '佛系',
        '淡定',
        '吃瓜',
        '羡慕',
        '嫉妒',
        '高冷',
        '冷淡',
        '热情',
        '抱歉',
        '求饶',
        '拜托',
        '冲鸭',
        '好耶',
        '离谱',
        '破防了',
        'emo',
        '麻了',
        '笑死',
        '泪目',
        '阴阳怪气',
        '嘲讽',
        '调侃',
        '心疼',
        '心酸',
        '心累',
        '心塞',
        '心痛',
        '空虚',
        '孤独',
        '寂寞',
        '无聊',
        '烦躁',
        '暴躁',
        '暴怒',
        '狂喜',
        '害羞脸',
        '震惊脸',
        '无语脸',
        '嫌弃脸',
        '嘟嘴',
        '鼓嘴',
        '冷汗',
    ].map((s) => s.toLowerCase()),
);

function normTag(t: string): string {
    return String(t || '')
        .trim()
        .replace(/\s+/g, '');
}

function asTagList(raw: unknown, max = 8): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
        const t = normTag(String(x));
        if (!t || t.length > 16) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
        if (out.length >= max) break;
    }
    return out;
}

export type ClassifiedStickerTags = {
    emotionTags: string[];
    styleTags: string[];
    sceneTags: string[];
    contentTags: string[];
    subjectTags: string[];
    tags: string[];
};

function looksLikeOcrOrPhrase(t: string): boolean {
    if (t.length >= 5) return true;
    if (/^ocr[:：]/i.test(t)) return true;
    if (/[“”"'「」]/.test(t)) return true;
    // 含空格/标点的配文
    if (/[\s…~～!！?？]/.test(t) && t.length >= 3) return true;
    return false;
}

/**
 * 将扁平 tags 拆成 emotion / style / scene / content / subject。
 * 优先信任模型分桶；扁平 tags 里漏分的词按词表与启发式归类。
 */
export function classifyStickerTags(input: {
    tags?: string[];
    emotionTags?: string[];
    styleTags?: string[];
    sceneTags?: string[];
    contentTags?: string[];
    subjectTags?: string[];
}): ClassifiedStickerTags {
    const styleFromModel = asTagList(input.styleTags, 6);
    const emotionFromModel = asTagList(input.emotionTags, 8);
    const sceneFromModel = asTagList(input.sceneTags, 4);
    const contentFromModel = asTagList(input.contentTags, 6);
    const subjectFromModel = asTagList(input.subjectTags, 6);
    const flat = asTagList(input.tags, 16);

    const styleKeys = new Set(styleFromModel.map((t) => t.toLowerCase()));
    const emotionKeys = new Set(emotionFromModel.map((t) => t.toLowerCase()));
    const sceneKeys = new Set(sceneFromModel.map((t) => t.toLowerCase()));
    const contentKeys = new Set(contentFromModel.map((t) => t.toLowerCase()));
    const subjectKeys = new Set(subjectFromModel.map((t) => t.toLowerCase()));

    const styleTags = [...styleFromModel];
    const emotionTags = [...emotionFromModel];
    const sceneTags = [...sceneFromModel];
    const contentTags = [...contentFromModel];
    const subjectTags = [...subjectFromModel];

    const claimed = (key: string) =>
        styleKeys.has(key) ||
        emotionKeys.has(key) ||
        sceneKeys.has(key) ||
        contentKeys.has(key) ||
        subjectKeys.has(key);

    for (const t of flat) {
        const key = t.toLowerCase();
        if (claimed(key)) continue;
        if (STICKER_STYLE_META_TAGS.has(key)) {
            styleTags.push(t);
            styleKeys.add(key);
            continue;
        }
        if (!emotionFromModel.length && STICKER_EMOTION_HINTS.has(key)) {
            emotionTags.push(t);
            emotionKeys.add(key);
            continue;
        }
        if (STICKER_SCENE_HINTS.has(key)) {
            sceneTags.push(t);
            sceneKeys.add(key);
            continue;
        }
        if (STICKER_CONTENT_HINTS.has(key) || looksLikeOcrOrPhrase(t)) {
            contentTags.push(t);
            contentKeys.add(key);
            continue;
        }
        // 默认归主体（角色/外貌）
        subjectTags.push(t);
        subjectKeys.add(key);
    }

    // 模型误把形式词放进其它桶：纠正到 style
    const scrubStyleLeak = (list: string[], keys: Set<string>) =>
        list.filter((t) => {
            const key = t.toLowerCase();
            if (!STICKER_STYLE_META_TAGS.has(key)) return true;
            if (!styleKeys.has(key)) {
                styleTags.push(t);
                styleKeys.add(key);
            }
            keys.delete(key);
            return false;
        });

    const emotionClean = scrubStyleLeak(emotionTags, emotionKeys);
    const sceneClean = scrubStyleLeak(sceneTags, sceneKeys);
    const contentClean = scrubStyleLeak(contentTags, contentKeys);
    const subjectClean = scrubStyleLeak(subjectTags, subjectKeys);

    const all: string[] = [];
    const allKeys = new Set<string>();
    for (const t of [
        ...emotionClean,
        ...subjectClean,
        ...contentClean,
        ...sceneClean,
        ...styleTags,
    ]) {
        const key = t.toLowerCase();
        if (allKeys.has(key)) continue;
        allKeys.add(key);
        all.push(t);
    }

    return {
        emotionTags: emotionClean.slice(0, 8),
        styleTags: styleTags.slice(0, 6),
        sceneTags: sceneClean.slice(0, 4),
        contentTags: contentClean.slice(0, 6),
        subjectTags: subjectClean.slice(0, 6),
        tags: all.slice(0, 16),
    };
}

/**
 * 阿里云百炼 qwen3.7-plus 看图（OpenAI 兼容、独立 visionApiKey）。
 * 多图同一请求批量分析，返回与入参顺序一致的结果数组；失败返回 null。
 */
export async function visionSummarize(
    images: VisionInputImage[],
    cfg: ChatbotRuntimeConfig,
): Promise<VisionResult[] | null> {
    if (!images.length || !cfg.visionApiKey) return null;
    const openai = new OpenAI({ apiKey: cfg.visionApiKey, baseURL: cfg.visionBaseURL });
    const dataUrls = await Promise.all(images.map(toVisionDataUrl));
    const multi = images.length > 1;
    const itemSchema =
        '{"summary":"一句话内容概要","is_meme":true|false,"emotion_tags":["情感"],"style_tags":["形式"],"scene_tags":["场景"],"content_tags":["内容/动作/文案"],"subject_tags":["主体/外貌"],"nsfw_risk":"low|mid|high"}';
    const schemaHint = multi ? `{"images":[${itemSchema},...]}` : itemSchema;
    const prompt = [
        '用简洁中文输出 JSON（不要多余文字）：',
        schemaHint,
        multi ? '每张图对应一个元素，顺序与输入一致。' : '',
        'summary 供检索与回复。',
        VISION_TAG_RULES,
        VISION_MEME_RULES,
    ]
        .filter(Boolean)
        .join('\n');

    const completion = await openai.chat.completions.create({
        model: cfg.visionModel,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    ...dataUrls.map((url) => ({
                        type: 'image_url' as const,
                        image_url: { url },
                    })),
                ],
            },
        ],
        max_tokens: 1200,
        temperature: 0.2,
    });
    const raw = completion.choices?.[0]?.message?.content || '';
    log.debug(`visionSummarize raw: ${raw}`);
    const json = extractJson(raw) as { images?: VisionResult[] } | VisionResult | null;
    if (!json || typeof json !== 'object') return null;
    const list = (json as { images?: VisionResult[] }).images;
    if (Array.isArray(list)) {
        return list.slice(0, images.length).map(normalizeVisionResult);
    }
    return [normalizeVisionResult(json as VisionResult)];
}

function normalizeVisionResult(v: unknown): VisionResult {
    const o = (v || {}) as Record<string, any>;
    // 模型常返回 snake_case（nsfw_risk / is_meme / emotion_tags）
    const riskRaw = o.nsfw_risk ?? o.nsfwRisk;
    const risk = (['low', 'mid', 'high'].includes(String(riskRaw)) ? String(riskRaw) : 'low') as
        | 'low'
        | 'mid'
        | 'high';
    const rawMeme = o.is_meme ?? o.isMeme;
    const classified = classifyStickerTags({
        tags: Array.isArray(o.tags) ? o.tags : [],
        emotionTags: o.emotion_tags ?? o.emotionTags,
        styleTags: o.style_tags ?? o.styleTags,
        sceneTags: o.scene_tags ?? o.sceneTags,
        contentTags: o.content_tags ?? o.contentTags,
        subjectTags: o.subject_tags ?? o.subjectTags,
    });
    return {
        summary: String(o.summary || '').trim(),
        tags: classified.tags,
        emotionTags: classified.emotionTags,
        styleTags: classified.styleTags,
        sceneTags: classified.sceneTags,
        contentTags: classified.contentTags,
        subjectTags: classified.subjectTags,
        nsfwRisk: risk,
        isMeme:
            rawMeme === true ||
            rawMeme === 1 ||
            ['true', '1'].includes(String(rawMeme).toLowerCase()),
    };
}

export interface BotActionPartText {
    type: 'text';
    text: string;
}
export interface BotActionPartImage {
    type: 'library_image';
    query: string;
    reason?: string;
}
export interface BotActionPartMention {
    type: 'mention';
    /** 被 @ 用户的 openid；必须来自本轮消息中的 <@openid>，禁止编造 */
    openid: string;
    reason?: string;
}
export type BotActionPart = BotActionPartText | BotActionPartImage | BotActionPartMention;
export interface BotAction {
    action: 'reply' | 'silent';
    parts: BotActionPart[];
}

/** 解析 dpsk 结构化动作；失败时整段文本降级为 text part */
export function parseBotAction(content: string): BotAction {
    const json = extractJson(content) as Partial<BotAction> | null;
    if (json && typeof json === 'object' && Array.isArray(json.parts)) {
        const parts: BotActionPart[] = [];
        for (const p of json.parts) {
            if (!p || typeof p !== 'object') continue;
            if (p.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
                parts.push({ type: 'text', text: p.text.trim() });
            } else if (p.type === 'library_image' && typeof p.query === 'string') {
                parts.push({ type: 'library_image', query: p.query.trim(), reason: p.reason });
            } else if (p.type === 'mention' && typeof p.openid === 'string' && p.openid.trim()) {
                parts.push({ type: 'mention', openid: p.openid.trim(), reason: p.reason });
            }
        }
        return { action: json.action === 'silent' ? 'silent' : 'reply', parts };
    }
    const text = content.trim();
    return text
        ? { action: 'reply', parts: [{ type: 'text', text }] }
        : { action: 'silent', parts: [] };
}

/**
 * H2 风控门控：对接自部署 Qwen3Guard-Stream-0.6B FastAPI（POST {baseURL}/moderate）。
 * 只判定「本次用户消息」：不携带历史/群/触发等元信息，避免上下文影响审核结论。
 * Safe → reply；Controversial / Unsafe / 未知 → noop；服务失败 → error（非 Must fail-closed，Must 由调用方放行）。
 * 输入截断控制 CPU 推理耗时（实测 ~6.5ms/字：600 字≈3.2s，1500 字≈9.5s）。
 */
export async function gateCheck(
    input: { current: string },
    cfg: ChatbotRuntimeConfig,
): Promise<'reply' | 'noop' | 'error'> {
    if (!cfg.gate.enabled) return 'reply';
    try {
        const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);
        const base = cfg.gate.baseURL.replace(/\/+$/, '');
        const { data } = await axios.post<{
            user?: { risk_level?: string; category?: string };
        }>(
            `${base}/moderate`,
            {
                messages: [{ role: 'user' as const, content: clip(input.current, 600) }],
                include_token_detail: false,
            },
            { timeout: cfg.gate.timeoutMs, proxy: false },
        );
        const level = String(data?.user?.risk_level || '').trim();
        if (level === 'Safe') return 'reply';
        log.warn(
            `chatbot gate 拦截: risk_level=${level || '未知'} category=${data?.user?.category || '-'}`,
        );
        return 'noop';
    } catch (err) {
        log.error('chatbot gate failed, fail-closed noop', err);
        return 'error';
    }
}
