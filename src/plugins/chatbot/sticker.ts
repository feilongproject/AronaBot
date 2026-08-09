import axios from 'axios';
import crypto from 'crypto';
import imageSize from 'image-size';
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
 * 自动抓取流水线（偷图 → 去重 → COS → qwen3.7-plus 打标 → chatSticker ready，无人工审核）。
 * 与观察写库并行调用，不阻塞回复路径。
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
    const readyCount = await col.countDocuments({ status: 'ready' }).catch(() => 0);
    if (readyCount >= cfg.stickerLibraryMax) return;

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
    if (exists) return;

    if (!isCapturable(img, cfg)) return;

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

    // is_meme 判定：非表情包不入库（只打标，供统计/调试）
    if (!result.isMeme) {
        if (devEnv)
            log.debug(
                `chatbot 非表情包不入库 hash=${contentHash.slice(0, 8)} summary=${result.summary}`,
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

    const doc = {
        _id: contentHash,
        botType: 'PlanaBot',
        groupOpenid: msg.group_openid,
        cosKey,
        sourceUrl: img.att.url,
        contentHash,
        summary: result.summary,
        tags: result.tags,
        nsfwRisk: result.nsfwRisk,
        isMeme: result.isMeme,
        status: result.nsfwRisk === 'high' ? ('rejected' as const) : ('ready' as const),
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
            `chatbot 表情入库 ${doc.status} hash=${contentHash.slice(0, 8)} summary=${doc.summary}`,
        );
}

/**
 * 抓取过滤：
 * - sticker（默认）：动画表情（gif/webp）或 小尺寸静态表情包（jpg/png，≤512px 或 ≤512KB），普通大照片不保存
 * - animated_only：只收动画表情（gif/webp）
 * - emoji_like：只收小图/表情比例
 * - all_images：全部图片
 */
export function isCapturable(
    img: Pick<PreparedImage, 'ext' | 'mime' | 'width' | 'height' | 'buffer'>,
    cfg: ChatbotRuntimeConfig,
): boolean {
    if (cfg.stickerCaptureMode === 'sticker') {
        const animated =
            img.ext === 'gif' || img.ext === 'webp' || /^image\/(gif|webp)$/.test(img.mime);
        if (animated) return true;
        const w = img.width || 0;
        const h = img.height || 0;
        const small = w && h && Math.max(w, h) <= 512;
        const tiny = img.buffer.length <= 512 * 1024;
        return small || tiny;
    }
    if (cfg.stickerCaptureMode === 'animated_only') {
        return img.ext === 'gif' || img.ext === 'webp' || /^image\/(gif|webp)$/.test(img.mime);
    }
    if (cfg.stickerCaptureMode === 'emoji_like') {
        const w = img.width || 0;
        const h = img.height || 0;
        const small = (w && h && Math.max(w, h) <= 512) || img.ext === 'gif' || img.ext === 'webp';
        const tiny = img.buffer.length <= 512 * 1024;
        return small || tiny;
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
