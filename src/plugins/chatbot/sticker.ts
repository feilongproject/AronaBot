import axios from 'axios';
import crypto from 'crypto';
import imageSize from 'image-size';
import sharp from 'sharp';
import { Jieba } from '@node-rs/jieba';
import { pushToDB } from '../../libs/common';
import { IMessageGROUP } from '../../libs/IMessageEx';
import { ChatbotRuntimeConfig } from './config';
import { visionSummarize, VisionInputImage, VisionResult } from './models';
import { CHAT_COLLECTION, aiDb, chatCollection } from './db';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';

export interface PreparedImage extends VisionInputImage {
    att: IntentMessage.Attachment;
    filename: string;
}

function isImageAtt(att: IntentMessage.Attachment): boolean {
    const mime = att.content_type || '';
    if (/^image\//.test(mime)) return true;
    return /\.(png|jpe?g|gif|webp|bmp)$/i.test(att.filename || '');
}

/** 下载 + 体积/类型门禁 + 尺寸读取 */
export async function prepareMessageImages(
    msg: IMessageGROUP,
    cfg: ChatbotRuntimeConfig,
    maxCount = 6,
): Promise<PreparedImage[]> {
    const out: PreparedImage[] = [];
    for (const att of (msg.attachments || []).slice(0, maxCount)) {
        const p = await prepareOne(att, cfg).catch((err) => {
            if (devEnv) log.debug('chatbot prepare image skip:', err);
            return null;
        });
        if (p) out.push(p);
    }
    return out;
}

async function prepareOne(
    att: IntentMessage.Attachment,
    cfg: ChatbotRuntimeConfig,
): Promise<PreparedImage | null> {
    if (!isImageAtt(att)) return null;
    if (att.size > cfg.stickerMaxBytes) return null;
    const res = await axios<ArrayBuffer>({
        url: att.url,
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'User-Agent': UA },
    });
    const buf = Buffer.from(res.data);
    if (buf.length > cfg.stickerMaxBytes) return null;

    const mime = att.content_type || 'image/png';
    const ext = (mime.split('/')[1] || (att.filename || '').split('.').pop() || 'png')
        .toLowerCase()
        .replace('jpeg', 'jpg');
    let width = att.width;
    let height = att.height;
    try {
        const size = imageSize(buf);
        width = width || size.width;
        height = height || size.height;
    } catch {
        // 尺寸未知不阻塞
    }
    return { att, buffer: buf, mime, ext, width, height, filename: att.filename || '' };
}

/**
 * 自动抓取流水线（偷图 → 去重 → COS → qwen3.7-plus 打标 → chatSticker）。
 * 默认 status=pending 待人工审核；stickerAutoApprove=true 时直接 ready。
 * nsfw_risk=high 一律 rejected。与观察写库并行调用，不阻塞回复路径。
 */
export async function captureStickerAsync(
    msg: IMessageGROUP,
    cfg: ChatbotRuntimeConfig,
): Promise<void> {
    if (!aiDb() || !cfg.stickerCaptureEnabled) return;
    if (!msg.attachments?.length) return;
    if (msg.author?.bot) return; // 防环：不抓 bot 自己发出的图
    if (cfg.stickerBlacklistUserIds?.includes(msg.author.id)) return;

    const col = chatCollection(CHAT_COLLECTION.sticker);
    // ready + pending 合计计入库上限，避免待审池无限堆积
    const storedCount = await col
        .countDocuments({ status: { $in: ['ready', 'pending'] } })
        .catch(() => 0);
    if (storedCount >= cfg.stickerLibraryMax) return;

    const images = await prepareMessageImages(msg, cfg, 4);
    for (const img of images) {
        try {
            await captureOne(msg, img, cfg);
        } catch (err) {
            if (devEnv) log.debug('chatbot captureOne skip:', err);
        }
    }
}

async function captureOne(
    msg: IMessageGROUP,
    img: PreparedImage,
    cfg: ChatbotRuntimeConfig,
): Promise<void> {
    const col = chatCollection(CHAT_COLLECTION.sticker);
    const contentHash = crypto.createHash('sha1').update(img.buffer).digest('hex');
    const exists = await col.findOne({ contentHash }, { projection: { _id: 1 } }).catch(() => null);
    if (exists) {
        if (devEnv)
            log.debug(`chatbot 跳过精确重复 hash=${contentHash.slice(0, 8)}`);
        return;
    }

    if (!isCapturable(img, cfg)) return;

    // 尺寸启发式：明显手机/长截图等非表情包，跳过 vision 节省费用
    const shotReason = looksLikeNonStickerShot(img);
    if (shotReason) {
        if (devEnv)
            log.debug(
                `chatbot 跳过非表情包截图 hash=${contentHash.slice(0, 8)} reason=${shotReason}`,
            );
        return;
    }

    // 感知哈希相似度去重（须在 vision 前，省看图费用）
    const phash = await computeDHash(img.buffer);
    if (phash) {
        const similar = await findSimilarByPhash(col, phash, cfg.stickerDedupHamming);
        if (similar) {
            if (devEnv)
                log.debug(
                    `chatbot 跳过相似表情 hash=${contentHash.slice(0, 8)} phash=${phash} dist=${similar.dist} exist=${String(similar._id).slice(0, 8)}`,
                );
            return;
        }
    }

    const result = await analyzeSticker(img, cfg);
    if (!result) return; // 无 vision 密钥或分析失败：暂不入库（等待补标可选）

    // 选择是否存入图库：false=只打标不入库（调试/统计用）
    if (!cfg.stickerCaptureStore) {
        if (devEnv)
            log.debug(
                `chatbot 已打标但未入库（stickerCaptureStore=false） hash=${contentHash.slice(0, 8)} summary=${result.summary}`,
            );
        return;
    }

    // is_meme + 文本复核：聊天记录 / App 截图等一律不入库
    const rejectReason = nonStickerRejectReason(result, img);
    if (rejectReason) {
        if (devEnv)
            log.debug(
                `chatbot 非表情包不入库 hash=${contentHash.slice(0, 8)} reason=${rejectReason} summary=${result.summary}`,
            );
        return;
    }

    const cosKey = `chatbot/sticker/${msg.group_openid}/${contentHash}.${img.ext}`;
    await cosPutObject({
        Key: cosKey,
        Body: img.buffer,
        ContentLength: img.buffer.length,
        ContentType: img.mime || 'image/png',
    });

    // nsfw high → rejected；否则按 stickerAutoApprove 决定 ready 或 pending
    const status =
        result.nsfwRisk === 'high'
            ? ('rejected' as const)
            : cfg.stickerAutoApprove
              ? ('ready' as const)
              : ('pending' as const);

    const doc = {
        _id: contentHash,
        botType,
        groupOpenid: msg.group_openid,
        cosKey,
        sourceUrl: img.att.url,
        contentHash,
        phash: phash || undefined,
        summary: result.summary,
        tags: result.tags,
        nsfwRisk: result.nsfwRisk,
        isMeme: true,
        status,
        width: img.width,
        height: img.height,
        byteSize: img.buffer.length,
        captureFromMsgId: msg.id,
        captureAuthorId: msg.author.id,
        useCount: 0,
        ts: new Date(),
    };
    await pushToDB(CHAT_COLLECTION.sticker, doc, aiDb());
    if (devEnv)
        log.debug(
            `chatbot 表情入库 ${doc.status} hash=${contentHash.slice(0, 8)} phash=${phash || '-'} summary=${doc.summary}`,
        );
}

/**
 * dHash（difference hash）：9×8 灰度 → 64 bit hex。
 * 对重编码 / 轻微缩放 / 压缩噪声较稳健，适合表情包相似去重。
 */
export async function computeDHash(buffer: Buffer): Promise<string | null> {
    try {
        const raw = await sharp(buffer, { animated: false, pages: 1 })
            .rotate()
            .greyscale()
            .resize(9, 8, { fit: 'fill' })
            .raw()
            .toBuffer();
        // 72 像素：每行 9 列，比较相邻列 → 8×8 位
        let bits = '';
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const left = raw[y * 9 + x];
                const right = raw[y * 9 + x + 1];
                bits += left < right ? '1' : '0';
            }
        }
        let hex = '';
        for (let i = 0; i < 64; i += 4) {
            hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
        }
        return hex;
    } catch (err) {
        if (devEnv) log.debug('computeDHash failed', err);
        return null;
    }
}

function hammingHex64(a: string, b: string): number {
    if (!a || !b || a.length !== b.length) return 64;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
        let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
        // 4-bit popcount（Brian Kernighan）
        while (x) {
            dist++;
            x &= x - 1;
        }
    }
    return dist;
}

/**
 * 在库内找感知哈希距离 ≤ threshold 的已有表情。
 * 库规模通常 ≤ stickerLibraryMax（百级），全量扫描 phash 可接受。
 * threshold≤0 时关闭相似去重（仅 contentHash 精确去重）。
 */
async function findSimilarByPhash(
    col: ReturnType<typeof chatCollection>,
    phash: string,
    threshold: number,
): Promise<{ _id: string; phash: string; dist: number } | null> {
    if (!phash || threshold <= 0) return null;
    const docs = await col
        .find(
            { phash: { $type: 'string', $ne: '' } },
            { projection: { _id: 1, phash: 1 } },
        )
        .limit(2000)
        .toArray()
        .catch(() => [] as { _id: unknown; phash?: string }[]);

    let best: { _id: string; phash: string; dist: number } | null = null;
    for (const d of docs) {
        const other = String(d.phash || '');
        if (!other) continue;
        const dist = hammingHex64(phash, other);
        if (dist <= threshold && (!best || dist < best.dist)) {
            best = { _id: String(d._id), phash: other, dist };
            if (dist === 0) break;
        }
    }
    return best;
}

function isAnimatedImage(
    img: Pick<PreparedImage, 'ext' | 'mime'>,
): boolean {
    return img.ext === 'gif' || img.ext === 'webp' || /^image\/(gif|webp)$/.test(img.mime);
}

/**
 * 尺寸启发式：拦截明显非表情包的截图/长图（动画表情除外）。
 * 返回拒绝原因字符串；通过则 null。
 */
export function looksLikeNonStickerShot(
    img: Pick<PreparedImage, 'ext' | 'mime' | 'width' | 'height' | 'buffer'>,
): string | null {
    if (isAnimatedImage(img)) return null;
    const w = img.width || 0;
    const h = img.height || 0;
    if (!w || !h) return null;
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    const ratio = long / short;

    // 竖长/横长：典型手机全屏截图、聊天长截图
    if (ratio >= 1.9 && long >= 640) return `aspect_screenshot ratio=${ratio.toFixed(2)} ${w}x${h}`;
    // 超长滚动截图
    if (ratio >= 2.4 && long >= 900) return `long_scroll_shot ratio=${ratio.toFixed(2)} ${w}x${h}`;
    // 高分辨率大图且明显非方图（海报/相册/App 大屏）
    if (long >= 1200 && short >= 500 && ratio >= 1.5)
        return `large_ui_shot ratio=${ratio.toFixed(2)} ${w}x${h}`;
    // 体积偏大且边长很大：表情包极少超过 1MB 的静态大图
    if (img.buffer.length >= 900 * 1024 && long >= 900)
        return `heavy_static_shot size=${img.buffer.length} ${w}x${h}`;
    return null;
}

/**
 * summary/tags 中出现聊天记录、App 界面等关键词时强制非表情包。
 * 覆盖 vision 误标 is_meme=true 的情况。
 */
const NON_STICKER_TEXT_RE =
    /聊天记录|聊天截图|对话记录|会话截图|消息记录|消息列表|气泡列表|微信截图|QQ截图|QQ界面|微信界面|App截图|应用截图|软件截图|手机截图|屏幕截图|界面截图|系统截图|桌面截图|通知栏|状态栏|导航栏|底部栏|浏览器截图|网页截图|游戏截图|设置页|控制面板|长截图|滚动截图|IM界面|会话列表|通讯录|朋友圈|相册截图|截屏|screenshot|chat\s*log|chat\s*history/i;

export function nonStickerRejectReason(
    result: Pick<VisionResult, 'isMeme' | 'summary' | 'tags'>,
    img?: Pick<PreparedImage, 'ext' | 'mime' | 'width' | 'height' | 'buffer'>,
): string | null {
    if (!result.isMeme) return 'vision_is_meme_false';
    const text = `${result.summary || ''} ${(result.tags || []).join(' ')}`;
    if (NON_STICKER_TEXT_RE.test(text)) return `text_hint:${text.slice(0, 80)}`;
    if (img) {
        const shot = looksLikeNonStickerShot(img);
        if (shot) return shot;
    }
    return null;
}

/**
 * 抓取过滤：
 * - sticker（默认）：动画表情（gif/webp）或 小尺寸静态表情包（jpg/png，≤512px 或 ≤512KB），普通大照片不保存
 * - animated_only：只收动画表情（gif/webp）
 * - emoji_like：只收小图/表情比例
 * - all_images：全部图片（仍会经截图启发式 + is_meme 二次过滤）
 */
export function isCapturable(
    img: Pick<PreparedImage, 'ext' | 'mime' | 'width' | 'height' | 'buffer'>,
    cfg: ChatbotRuntimeConfig,
): boolean {
    if (cfg.stickerCaptureMode === 'sticker') {
        if (isAnimatedImage(img)) return true;
        const w = img.width || 0;
        const h = img.height || 0;
        const small = w && h && Math.max(w, h) <= 512;
        const tiny = img.buffer.length <= 512 * 1024;
        return !!(small || tiny);
    }
    if (cfg.stickerCaptureMode === 'animated_only') {
        return isAnimatedImage(img);
    }
    if (cfg.stickerCaptureMode === 'emoji_like') {
        const w = img.width || 0;
        const h = img.height || 0;
        const small = (w && h && Math.max(w, h) <= 512) || isAnimatedImage(img);
        const tiny = img.buffer.length <= 512 * 1024;
        return !!(small || tiny);
    }
    return true;
}

async function analyzeSticker(
    img: PreparedImage,
    cfg: ChatbotRuntimeConfig,
): Promise<VisionResult | null> {
    if (!cfg.visionApiKey) return null;
    const res = await visionSummarize([img], cfg);
    return res?.[0] || null;
}

const jieba = new Jieba();

function tokenize(text: string): string[] {
    const words = jieba.cut(text || '');
    return words
        .map((w) => w.trim())
        .filter(
            (w) =>
                w.length > 1 &&
                !/^[\s\d\W_]+$/.test(w) &&
                !['的', '了', '吗', '呢', '吧', '啊', '喵'].includes(w),
        );
}

/**
 * 语义选图：status=ready 且 nsfwRisk!=high；tags 命中 2 分、summary 命中 1 分，
 * 同分优先未使用/较新。一期关键词打分，Top-K LLM 精排归 P3。
 */
export async function pickSticker(
    groupOpenid: string,
    query: string,
    cfg: ChatbotRuntimeConfig,
): Promise<{
    _id: string;
    cosKey: string;
    summary: string;
    tags: string[];
    width?: number;
    height?: number;
} | null> {
    if (!aiDb()) return null;
    const docs = await chatCollection(CHAT_COLLECTION.sticker)
        .find({
            status: 'ready',
            nsfwRisk: { $ne: 'high' },
            groupOpenid: { $in: [groupOpenid, '*'] },
        })
        .sort({ ts: -1 })
        .limit(200)
        .toArray()
        .catch((err) => {
            log.error('pickSticker query failed', err);
            return [];
        });
    if (!docs.length) return null;

    const terms = tokenize(query);
    let best: (typeof docs)[number] | null = null;
    let bestScore = -1;
    for (const d of docs) {
        let score = 0;
        const tagText = (d.tags || []).join(' ');
        const summary = d.summary || '';
        for (const t of terms) {
            if (tagText.includes(t)) score += 2;
            else if (summary.includes(t)) score += 1;
        }
        if (d.isMeme) score += 1; // 表情包优先
        if (score === 0 && terms.length) continue;
        score -= Math.min(d.useCount || 0, 3) * 0.5; // 优先未用过的
        if (!best || score > bestScore) {
            best = d;
            bestScore = score;
        }
    }
    if (!best) return null;
    return {
        _id: String(best._id),
        cosKey: best.cosKey,
        summary: best.summary,
        tags: best.tags || [],
        width: best.width,
        height: best.height,
    };
}

/** bot 发出表情后更新使用计数 */
export async function markStickerUsed(stickerId: string): Promise<void> {
    if (!aiDb()) return;
    await chatCollection(CHAT_COLLECTION.sticker)
        .updateOne({ _id: stickerId }, { $inc: { useCount: 1 }, $set: { lastUsedAt: new Date() } })
        .catch((err) => log.error('markStickerUsed failed', err));
}
