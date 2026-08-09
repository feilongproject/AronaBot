import { pushToDB } from '../../libs/common';
import { IMessageGROUP } from '../../libs/IMessageEx';
import { ChatbotRuntimeConfig } from './config';
import { estimateTokens, summarizeTranscript } from './models';
import type { Collection, Db } from 'mongodb';

export const CHAT_COLLECTION = {
    context: 'chatContext',
    memory: 'chatMemory',
    meta: 'chatSessionMeta',
    sticker: 'chatSticker',
    noop: 'chatNoop',
} as const;

/** 宽松文档类型：本项目 _id 大量使用字符串（eventId/msgId/hash） */
export interface ChatDoc {
    _id?: string;
    [key: string]: any;
}

/** AI 专用库：优先 config/ai.json 配置的 aiMongoDb，未配置时回落 bot 主库 */
export function aiDb(): Db | undefined {
    return global.aiMongoDb || global.mongoDb;
}

/** 集合句柄：按宽松文档类型访问，避免 mongodb 默认 ObjectId _id 约束 */
export function chatCollection<T extends ChatDoc = ChatDoc>(name: string): Collection<T> {
    return aiDb()!.collection(name) as Collection<T>;
}

export type ChatTrigger =
    | 'must_at'
    | 'must_prefix'
    | 'hybrid'
    | 'hybrid_reply_chain'
    | 'observe'
    | 'command';

export interface ChatImageMeta {
    url: string;
    cosKey?: string;
    visionSummary?: string;
    tags?: string[];
    isMeme?: boolean;
    w?: number;
    h?: number;
}

/** 启动/热更新时幂等建索引（去重统一按消息 id：msgId 唯一稀疏） */
export async function ensureChatbotIndexes(): Promise<void> {
    if (!aiDb()) return;
    try {
        const db = aiDb()!;
        const ctxCol = chatCollection(CHAT_COLLECTION.context);

        // 清理历史索引：eventId 唯一、contentHash 唯一、groupOpenid+msgId 组合
        const existingNames = (await ctxCol.indexes()).map((i) => i.name);
        for (const oldName of [
            'eventId_1',
            'groupOpenid_1_contentHash_1_tsMinute_1',
            'groupOpenid_1_msgId_1',
        ]) {
            if (existingNames.includes(oldName)) {
                await ctxCol.dropIndex(oldName).catch((err) => {
                    log.error(`drop chatContext index ${oldName} failed`, err);
                });
            }
        }

        await Promise.all([
            ctxCol.createIndex({ groupOpenid: 1, ts: -1 }),
            // 按消息 id 去重：user/assistant 行均以 msgId 为唯一键
            ctxCol.createIndex({ msgId: 1 }, { unique: true, sparse: true }),
            db.collection(CHAT_COLLECTION.memory).createIndex({ groupOpenid: 1, seq: -1 }),
            db
                .collection(CHAT_COLLECTION.sticker)
                .createIndex({ status: 1, groupOpenid: 1, ts: -1 }),
            db
                .collection(CHAT_COLLECTION.sticker)
                .createIndex({ contentHash: 1 }, { unique: true }),
            db.collection(CHAT_COLLECTION.noop).createIndex({ groupOpenid: 1, ts: -1 }),
            db.collection(CHAT_COLLECTION.meta).createIndex({ groupOpenid: 1 }, { unique: true }),
        ]);
    } catch (err) {
        log.error('ensureChatbotIndexes failed', err);
    }
}

function rowId(msg: IMessageGROUP): string {
    // 去重统一按消息 id（msgId）；event_id 仅作事件溯源字段保留
    return msg.id || msg.event_id || '';
}

/** 观察写库：过准入的群消息一律先 insert（含未回复；超长标 ignored） */
export async function writeObserveRow(
    msg: IMessageGROUP,
    extra: {
        trigger: ChatTrigger;
        ignored?: boolean;
        ignoreReason?: string;
        images?: ChatImageMeta[];
    },
): Promise<void> {
    const db = aiDb();
    if (!db) return;
    await pushToDB(
        CHAT_COLLECTION.context,
        {
            _id: rowId(msg),
            botType: 'PlanaBot',
            groupOpenid: msg.group_openid,
            role: 'user',
            authorId: msg.author.id,
            authorName: msg.author.username || '',
            msgId: msg.id,
            eventId: msg.event_id,
            content: msg.content || '',
            rawContent: msg.content || '',
            images: extra.images,
            trigger: extra.trigger,
            replied: false,
            ignored: !!extra.ignored,
            ignoreReason: extra.ignoreReason,
            refMsgId: msg.refs?.refMsgIdx,
            ts: new Date(),
        },
        db,
    );
}

/** 判定回复后回写 replied / trigger */
export async function markObserveReplied(msg: IMessageGROUP, trigger: ChatTrigger): Promise<void> {
    if (!aiDb()) return;
    await chatCollection(CHAT_COLLECTION.context)
        .updateOne({ _id: rowId(msg) }, { $set: { replied: true, trigger } })
        .catch((err) => log.error('markObserveReplied failed', err));
}

/**
 * 白名单群中命中其他指令的用户消息也写入公共历史（bot 已通过指令回复，标 replied）。
 * 兜底（未命中指令）消息由 chatbot 插件内的 writeObserveRow 写入，不会走到这里。
 */
export async function writeUserObserveRow(msg: IMessageGROUP): Promise<void> {
    await writeObserveRow(msg, {
        trigger: 'command',
        images: (msg.attachments || []).map((a) => ({
            url: a.url,
            w: a.width,
            h: a.height,
        })),
    });
    await markObserveReplied(msg, 'command');
}

/** 附图转述完成后回写观察行的 images.visionSummary */
export async function attachVisionToObserve(
    msg: IMessageGROUP,
    images: ChatImageMeta[],
): Promise<void> {
    if (!aiDb() || !images.length) return;
    await chatCollection(CHAT_COLLECTION.context)
        .updateOne({ _id: rowId(msg) }, { $set: { images } })
        .catch(() => {});
}

export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

/** 单条历史格式化为带发言人信息的内容（AstrBot 风格：名称(id) 前缀） */
function formatHistoryLine(d: Record<string, any>, text: string, adminOpenid?: string): string {
    const who =
        d.role === 'assistant'
            ? d.authorName || botType || 'PlanaBot'
            : `${d.authorName || d.authorId || '用户'}(${d.authorId || 'unknown'})${
                  d.authorId && d.authorId === adminOpenid ? '[最高管理员]' : ''
              }`;
    let line = `[${who}] ${text}`;
    const summaries = (d.images || [])
        .map((i: Record<string, any>) => i.visionSummary)
        .filter(Boolean);
    if (summaries.length) line += `\n[附图摘要: ${summaries.join('；')}]`;
    return line;
}

/**
 * 上下文装配：近期未归档 raw（含 observe 与 assistant；排除 ignored 原文）。
 * 从新到旧按 workingContextTokens 预算截断。
 */
export async function assembleHistory(
    groupOpenid: string,
    currentRowId: string,
    cfg: ChatbotRuntimeConfig,
    maxTokens = cfg.workingContextTokens,
): Promise<HistoryMessage[]> {
    if (!aiDb()) return [];
    const docs = await chatCollection(CHAT_COLLECTION.context)
        .find({
            groupOpenid,
            _id: { $ne: currentRowId },
            archived: { $ne: true },
            ignored: { $ne: true },
            role: { $in: ['user', 'assistant'] },
        })
        .sort({ ts: -1 })
        .limit(Math.max(100, cfg.maxHistoryRounds * 3))
        .toArray();

    const out: HistoryMessage[] = [];
    let used = 0;
    for (const d of docs) {
        if (out.length >= cfg.maxHistoryRounds) break;
        const content = formatHistoryLine(d, d.content || '', cfg.adminOpenid);
        const cost = estimateTokens(content) + 4;
        if (used + cost > maxTokens && out.length) break;
        used += cost;
        out.unshift({
            role: d.role === 'assistant' ? 'assistant' : 'user',
            content,
        });
    }
    return out;
}

/** 最近 K 块记忆摘要（新→旧） */
export async function getRecentMemory(
    groupOpenid: string,
    maxBlocks: number,
): Promise<{ seq: number; summary: string }[]> {
    if (!aiDb()) return [];
    return chatCollection(CHAT_COLLECTION.memory)
        .find({ groupOpenid })
        .sort({ seq: -1 })
        .limit(maxBlocks)
        .project({ seq: 1, summary: 1 })
        .toArray()
        .then((rows) => rows.map((r) => ({ seq: r.seq, summary: r.summary })))
        .catch((err) => {
            log.error('getRecentMemory failed', err);
            return [];
        });
}

export async function updateSessionMeta(
    groupOpenid: string,
    patch: Record<string, unknown>,
): Promise<void> {
    if (!aiDb()) return;
    await chatCollection(CHAT_COLLECTION.meta)
        .updateOne(
            { _id: groupOpenid },
            { $set: { groupOpenid, ...patch, ts: new Date() }, $inc: { version: 1 } },
            { upsert: true },
        )
        .catch((err) => log.error('updateSessionMeta failed', err));
}

/** noop 记录：必含 groupOpenid、authorId、trigger、本轮输入、近期 history 快照 */
export async function recordNoop(
    msg: IMessageGROUP,
    trigger: ChatTrigger,
    history: HistoryMessage[],
    cfg: ChatbotRuntimeConfig,
): Promise<void> {
    const db = aiDb();
    if (!db) return;
    await pushToDB(
        CHAT_COLLECTION.noop,
        {
            _id: `${msg.group_openid}:${rowId(msg)}`,
            botType: 'PlanaBot',
            groupOpenid: msg.group_openid,
            authorId: msg.author.id,
            trigger,
            rawContent: msg.content || '',
            history: (history || []).slice(-20),
            cfgSnapshot: {
                workingContextTokens: cfg.workingContextTokens,
                chatModel: cfg.chatModel,
                gateModel: cfg.gate.model,
            },
            ts: new Date(),
        },
        db,
    );
}

/**
 * 双条件压缩：新增未归档 raw 条数 ≥ compressInterval 或 token ≥ compressTokenThreshold，
 * 满足任一即由 dpsk 生成 chatMemory 摘要并归档 raw、修剪 summary 块数。
 */
export async function maybeCompress(groupOpenid: string, cfg: ChatbotRuntimeConfig): Promise<void> {
    const db = aiDb();
    if (!db) return;
    const lockKey = `chat:compress:lock:${groupOpenid}`;
    const locked = await redis.set(lockKey, '1', { EX: 120, NX: true }).catch(() => null);
    if (locked !== 'OK') return;

    try {
        const col = chatCollection(CHAT_COLLECTION.context);
        const query = { groupOpenid, archived: { $ne: true }, ignored: { $ne: true } };
        const [count, raws] = await Promise.all([
            col.countDocuments(query),
            col.find(query).sort({ ts: 1 }).limit(500).toArray(),
        ]);
        const tokens = raws.reduce(
            (sum, r) => sum + estimateTokens(`${r.role || 'user'}: ${r.content || ''}`),
            0,
        );
        if (count < cfg.compressInterval && tokens < cfg.compressTokenThreshold) return;
        if (!raws.length) return;

        const transcript = raws
            .map((r) => {
                const speaker =
                    r.role === 'assistant'
                        ? r.authorName || botType || 'bot'
                        : `${r.authorName || r.authorId || 'user'}(${r.authorId || ''})`;
                return `[${r.ts instanceof Date ? r.ts.toISOString() : r.ts || ''}] ${speaker}: ${
                    r.content || ''
                }`;
            })
            .join('\n');
        const summary = await summarizeTranscript(groupOpenid, transcript, cfg);
        if (!summary) return;

        const last = await chatCollection(CHAT_COLLECTION.memory).findOne(
            { groupOpenid },
            { sort: { seq: -1 } },
        );
        const seq = Number(last?.seq || 0) + 1;
        const coverFrom = raws[0]?.ts;
        const coverTo = raws[raws.length - 1]?.ts;

        await pushToDB(
            CHAT_COLLECTION.memory,
            {
                _id: `${groupOpenid}:${seq}`,
                botType: 'PlanaBot',
                groupOpenid,
                seq,
                summary,
                coverFrom,
                coverTo,
                tokenEstimate: tokens,
                ts: new Date(),
            },
            db,
        );
        await col.updateMany(
            { _id: { $in: raws.map((r) => r._id) } },
            { $set: { archived: true } },
        );

        // 修剪 summary 块数 ≤ maxSummaryBlocks
        const memCol = chatCollection(CHAT_COLLECTION.memory);
        const keep = await memCol
            .find({ groupOpenid })
            .sort({ seq: -1 })
            .limit(cfg.maxSummaryBlocks)
            .toArray();
        if (keep.length) {
            await memCol.deleteMany({ groupOpenid, seq: { $lt: keep[keep.length - 1].seq } });
        }

        await updateSessionMeta(groupOpenid, {
            lastCompressAt: new Date(),
            recentTokenEstimate: 0,
        });
        if (devEnv)
            log.debug(`chatbot 压缩完成 group=${groupOpenid} rows=${raws.length} seq=${seq}`);
    } catch (err) {
        log.error('chatbot compress failed', err);
    }
}
