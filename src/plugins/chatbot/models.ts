import OpenAI from 'openai';
import axios from 'axios';
import sharp from 'sharp';
import { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import config from '../../../config/config';
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

/** DeepSeek 文本（OpenAI 兼容）；token 估算优先 API usage */
export async function chatCompletion(
    messages: ChatCompletionMessageParam[],
    cfg: ChatbotRuntimeConfig,
): Promise<ChatResult> {
    const apiKey = config.bots[botType]?.dsKey;
    if (!apiKey) throw new Error('chatbot: dsKey 未配置');
    const openai = new OpenAI({ apiKey, baseURL: cfg.baseURL });
    const completion = await openai.chat.completions.create({
        model: cfg.chatModel,
        messages,
        max_tokens: 600,
        temperature: 0.9,
    });
    return {
        content: completion.choices?.[0]?.message?.content || '',
        usage: parseUsage(completion.usage),
    };
}

/**
 * DeepSeek 文本 + MCP 工具调用（原生 function calling）。
 * 模型请求工具 → 执行（onToolCall）→ 以 role:'tool' 回填 → 循环，最多 maxToolRounds 轮；
 * 轮次耗尽后不带 tools 收尾一次，强制模型给出最终回复。
 */
export async function chatCompletionWithTools(
    messages: ChatCompletionMessageParam[],
    cfg: ChatbotRuntimeConfig,
    tools: ChatCompletionTool[],
    onToolCall: (fullName: string, argsText: string) => Promise<string>,
): Promise<ChatResult> {
    const apiKey = config.bots[botType]?.dsKey;
    if (!apiKey) throw new Error('chatbot: dsKey 未配置');
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
    tags: string[];
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
    const prompt = multi
        ? [
              '用简洁中文输出 JSON（不要多余文字）：',
              '{"images":[{"summary":"一句话内容概要","is_meme":true|false,"tags":["3~8个短标签"],"nsfw_risk":"low|mid|high"},...]}',
              '每张图对应一个元素，顺序与输入一致。',
              'summary 供检索与回复；tags 覆盖情绪/角色/梗/OCR 关键词。',
              VISION_MEME_RULES,
          ].join('\n')
        : [
              '用简洁中文输出 JSON（不要多余文字）：',
              '{"summary":"一句话内容概要","is_meme":true|false,"tags":["3~8个短标签"],"nsfw_risk":"low|mid|high"}',
              'summary 供检索与回复；tags 覆盖情绪/角色/梗/OCR 关键词。',
              VISION_MEME_RULES,
          ].join('\n');

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
        max_tokens: 1000,
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
    // 模型常返回 snake_case（nsfw_risk / is_meme）
    const riskRaw = o.nsfw_risk ?? o.nsfwRisk;
    const risk = (['low', 'mid', 'high'].includes(String(riskRaw)) ? String(riskRaw) : 'low') as
        | 'low'
        | 'mid'
        | 'high';
    const rawMeme = o.is_meme ?? o.isMeme;
    return {
        summary: String(o.summary || '').trim(),
        tags: Array.isArray(o.tags) ? o.tags.map(String).filter(Boolean).slice(0, 8) : [],
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
