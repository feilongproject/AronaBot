import { IMessageGROUP } from '../../libs/IMessageEx';
import { ChatbotRuntimeConfig } from './config';

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 清理 @ 后的正文。
 * keepUserMentions=true 时只去掉 bot 自己的 @，其他用户的 @ 保留为 <@openid>（供 AI 识别被 @ 的人）。
 */
export function cleanContent(msg: IMessageGROUP, keepUserMentions = false): string {
    let content = (msg.content || '').trim();
    if (keepUserMentions) {
        const botIds = new Set(
            (msg.mentions || [])
                .filter((m) => m.is_you)
                .flatMap((m) => [m.id, m.member_openid])
                .filter(Boolean),
        );
        content = content.replace(/<@!?([A-Za-z0-9_-]+)>/g, (all, id: string) =>
            botIds.has(id) ? '' : all,
        );
    } else {
        content = content.replace(/<@!?[A-Za-z0-9_-]*>/g, '');
    }
    return content.trim();
}

export interface MustResult {
    must: boolean;
    trigger: 'must_at' | 'must_prefix' | null;
    /** 剥离 @ / 先导词后的正文（先导词格式才剥离） */
    payload: string;
}

/**
 * Must 判定：
 * - @ 本 bot：mentions.is_you
 * - 先导词：去 @ 后 trim，满足 `^prefix\s+`（prefix 后必须至少一个空白）
 */
export function detectMust(msg: IMessageGROUP, cfg: ChatbotRuntimeConfig): MustResult {
    const atYou = msg.mentions?.some((m) => m.is_you);
    const cleaned = cleanContent(msg);
    const aiCleaned = cleanContent(msg, true);
    const prefixes = cfg.mustPrefixes || [];
    if (prefixes.length) {
        const re = new RegExp(`^(?:${prefixes.map(escapeRegExp).join('|')})\\s+(.*)$`, 'i');
        const m = re.exec(cleaned);
        if (m) {
            const am = re.exec(aiCleaned);
            return { must: true, trigger: 'must_prefix', payload: (am?.[1] || m[1]).trim() };
        }
    }
    if (atYou) return { must: true, trigger: 'must_at', payload: aiCleaned };
    return { must: false, trigger: null, payload: aiCleaned };
}

/** 回复 bot 判定主路径：ref_msg_idx 关联 bot 出站 msgId（Redis 3h 缓存） */
export async function isReplyToBotMsg(msg: IMessageGROUP): Promise<boolean> {
    const ref = msg.refs?.refMsgIdx;
    if (!ref) return false;
    return !!(await redis.exists(`chat:out:msg:${ref}`).catch(() => 0));
}

export interface ChainState {
    count: number;
    at: number;
}

async function getChainState(groupOpenid: string, cfg: ChatbotRuntimeConfig): Promise<ChainState> {
    const raw = await redis.get(`chat:chain:${groupOpenid}`).catch(() => null);
    const now = Date.now();
    let state: ChainState = { count: 0, at: now };
    if (raw) {
        try {
            state = JSON.parse(raw);
        } catch {
            state = { count: 0, at: now };
        }
    }
    if (now - Number(state.at || 0) > cfg.replyChainWindowSec * 1000) {
        state = { count: 0, at: now };
    }
    return state;
}

export async function bumpChain(groupOpenid: string, cfg: ChatbotRuntimeConfig): Promise<void> {
    const state = await getChainState(groupOpenid, cfg);
    state.count++;
    state.at = Date.now();
    await redis
        .setEx(`chat:chain:${groupOpenid}`, cfg.replyChainWindowSec, JSON.stringify(state))
        .catch(() => {});
}

/** Maybe 动态概率：回复 bot 后 0.7（链长超限回落 0.1），否则 0.1 */
export async function effectiveMaybeProbability(
    msg: IMessageGROUP,
    cfg: ChatbotRuntimeConfig,
): Promise<{ p: number; isReplyToBot: boolean }> {
    const isReply = await isReplyToBotMsg(msg);
    if (!isReply) return { p: cfg.replyProbability, isReplyToBot: false };
    const chain = await getChainState(msg.group_openid, cfg);
    if (chain.count >= cfg.replyChainMax) return { p: cfg.replyProbability, isReplyToBot: true };
    return { p: cfg.replyToBotProbability, isReplyToBot: true };
}

/** 群限流：1/s、10/min 硬顶（可配置） */
export async function checkRateLimit(
    groupOpenid: string,
    cfg: ChatbotRuntimeConfig,
): Promise<boolean> {
    const sKey = `chat:rl:s:${groupOpenid}`;
    const sCount = await redis.incr(sKey).catch(() => 0);
    if (sCount === 1) await redis.expire(sKey, 1).catch(() => {});
    if (sCount > cfg.rateLimitPerSecond) return false;

    const mKey = `chat:rl:m:${groupOpenid}`;
    const mCount = await redis.incr(mKey).catch(() => 0);
    if (mCount === 1) await redis.expire(mKey, 60).catch(() => {});
    if (mCount > cfg.rateLimitPerMinute) return false;
    return true;
}

/** 用户冷却；Must 可放宽但仍受 1/s、10/min 硬顶 */
export async function checkCooldown(
    authorId: string,
    groupOpenid: string,
    cfg: ChatbotRuntimeConfig,
): Promise<boolean> {
    const key = `chat:cd:user:${authorId}:${groupOpenid}`;
    const ok = await redis.set(key, '1', { EX: cfg.cooldownSec, NX: true }).catch(() => 'ERR');
    return ok !== 'OK';
}
