import { pushToDB } from '../../libs/common';
import config from '../../../config/config';
import { aiDb } from './db';

/** 归一化出站 content（去重用）：trim + 折叠连续空白 */
export function normalizeOutboundContent(content?: string): string {
    return (content || '').trim().replace(/\s+/g, ' ');
}

/**
 * 发送层统一出站记录（所有 bot 发送必须入 Mongo）。
 * - 仅全局 AI 宿主（ai.activeBot）+ chatbot 白名单群（group_openid）
 * - 在 callWithRetry 最终成功后调用，重试不重复写入
 * - 去重统一按消息 id（msgId 唯一稀疏索引）；不做 content hash 严格去重
 * - 同步缓存 bot 出站 msgId 近 3 小时（isReplyToBot 判定主路径）
 */
export async function recordGroupBotOutbound(
    options: {
        sendToId?: string;
        content?: string;
        imageUrl?: string;
        fileUrl?: string;
        imagePath?: string;
        imageFile?: Buffer;
    },
    result: unknown,
): Promise<void> {
    try {
        const db = aiDb();
        const owner = String(config.ai?.activeBot || '').trim();
        if (!owner || botType !== owner || !db) return;
        const groupOpenid = options.sendToId;
        if (!groupOpenid) return;
        const cfg = config.ai?.chatbot;
        if (!cfg?.enabled || !cfg.groups?.includes(groupOpenid)) return;

        const text = normalizeOutboundContent(options.content);
        const img =
            options.imageUrl ||
            options.fileUrl ||
            options.imagePath ||
            (options.imageFile ? `buffer:${options.imageFile.length}` : '');
        const hashInput = text || (img ? `img:${img}` : '');
        if (!hashInput) return;

        const raw = (result || {}) as any;
        const msgId = raw?.id || raw?.msg_id;
        // 近 3 小时出站 msgId 全量缓存，供「回复 bot」判定；
        // 群回复引用走 ext_info.ref_idx（入站 ref_msg_idx 与之对应）
        const refIdx = raw?.ext_info?.ref_idx;
        if (msgId) {
            await redis.setEx(`chat:out:msg:${msgId}`, 3 * 3600, groupOpenid).catch(() => {});
            await redis.lPush(`chat:out:${groupOpenid}`, String(msgId)).catch(() => {});
            await redis.lTrim(`chat:out:${groupOpenid}`, 0, 999).catch(() => {});
            await redis.expire(`chat:out:${groupOpenid}`, 3 * 3600).catch(() => {});
        }
        if (refIdx) {
            await redis.setEx(`chat:out:msg:${refIdx}`, 3 * 3600, groupOpenid).catch(() => {});
        }

        await pushToDB(
            'chatContext',
            {
                _id: msgId
                    ? String(msgId)
                    : `${groupOpenid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
                botType,
                groupOpenid,
                role: 'assistant',
                authorId: typeof meId !== 'undefined' ? meId : '',
                authorName: botType,
                msgId,
                // 出站 ext_info.ref_idx 与入站 ref_msg_idx 对应，供引用反查
                msgIdx: refIdx || undefined,
                content: text,
                images: img ? [{ url: img }] : undefined,
                trigger: 'assistant_send',
                replied: false,
                ts: new Date(),
            },
            db,
        );
    } catch (err) {
        log.error('recordGroupBotOutbound failed', err);
    }
}
