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
 * Must 判定（命中后忽略 Maybe 抽卡规则，直接回复）：
 * - 先导词：去 @ 后 trim，满足 `^prefix\s+`（prefix 后必须至少一个空白）
 * - @ 本 bot：mentions.is_you
 * 先导词优先于 @（同时存在时记为 must_prefix）。
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

function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
}

function pityKey(groupOpenid: string): string {
    return `chat:pity:${groupOpenid}`;
}

/** 读取当前群 Maybe 累计概率；无状态则回落初始值 replyProbability */
export async function getReplyPity(
    groupOpenid: string,
    cfg: ChatbotRuntimeConfig,
): Promise<number> {
    const base = clamp01(cfg.replyProbability);
    const raw = await redis.get(pityKey(groupOpenid)).catch(() => null);
    if (raw == null || raw === '') return base;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : base;
}

/**
 * Maybe 抽卡概率：
 * - 用当前累计 p 掷骰；命中则本条尝试回复（真正发出后再 reset）
 * - 未命中则 p += replyProbabilityStep（上限 1）
 * - 初始 p = replyProbability（默认 0.0005）
 */
export async function rollMaybePity(
    msg: IMessageGROUP,
    cfg: ChatbotRuntimeConfig,
): Promise<{ hit: boolean; p: number; isReplyToBot: boolean }> {
    const isReplyToBot = await isReplyToBotMsg(msg);
    const base = clamp01(cfg.replyProbability);
    const step = Math.max(0, Number(cfg.replyProbabilityStep) || 0);
    const p = await getReplyPity(msg.group_openid, cfg);
    const hit = Math.random() < p;
    if (hit) {
        if (devEnv) log.debug(`chatbot pity hit p=${p} base=${base} step=${step}`);
        // 命中后暂不重置，等 send 成功再 resetReplyPity；失败则下次仍以当前 p 再试
    } else {
        const next = clamp01(p + step);
        await redis.set(pityKey(msg.group_openid), String(next)).catch(() => {});
        if (devEnv) log.debug(`chatbot pity miss p=${p} → ${next}`);
    }
    return { hit, p, isReplyToBot };
}

/** 成功发出消息后清空累计概率到初始值 */
export async function resetReplyPity(
    groupOpenid: string,
    cfg: ChatbotRuntimeConfig,
): Promise<void> {
    const base = clamp01(cfg.replyProbability);
    await redis.set(pityKey(groupOpenid), String(base)).catch(() => {});
    if (devEnv) log.debug(`chatbot pity reset → ${base}`);
}

/**
 * @deprecated 已由 rollMaybePity 抽卡模型替代；只读当前累计 p，无副作用。
 */
export async function effectiveMaybeProbability(
    msg: IMessageGROUP,
    cfg: ChatbotRuntimeConfig,
): Promise<{ p: number; isReplyToBot: boolean }> {
    const isReplyToBot = await isReplyToBotMsg(msg);
    const p = await getReplyPity(msg.group_openid, cfg);
    return { p, isReplyToBot };
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
