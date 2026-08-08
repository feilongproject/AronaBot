import { IMessageGROUP } from './IMessageEx';
import config from '../../config/config';

/**
 * 通知管理员：回调群。
 * 对齐 biliDynamic.dynamicPush：本进程 groupMap 反查 openId + groupLastestEventId 主动发，
 * 不再走已废弃的 interaction.sendToGroupHandler / callbackToChannel。
 */
export async function sendToAdmin(content: string) {
    return callbackToGroup(`${content}\n${botType}`).catch((err) =>
        log.error('sendToAdmin failed:', err),
    );
}

/** 向 redis config.callbackGroup 对应群发送文本（与 B 站群推送同一套 eventId 路径） */
export async function callbackToGroup(content: string) {
    const callbackGroupUid = (await redis.hGet('config', 'callbackGroup')) as string | undefined;
    if (!callbackGroupUid) {
        log.error('callbackToGroup: 未配置 redis config.callbackGroup');
        return;
    }

    const openId = Object.entries(config.bots[botType].groupMap).find(
        ([, realId]) => realId == callbackGroupUid,
    )?.[0];
    if (!openId) {
        log.error(
            `callbackToGroup: 未在 groupMap 找到群 openId, callbackGroupUid=${callbackGroupUid}`,
        );
        return;
    }

    // 优先使用该群最近交互的 eventId，便于主动消息窗口内发送
    const eventId = await redis.get(`groupLastestEventId:${botType}:${openId}`);
    const msg = new IMessageGROUP(
        {
            group_id: openId,
            group_openid: openId,
            event_id: eventId || undefined,
            content: '',
            timestamp: new Date().toISOString(),
            author: { id: '', username: '', bot: true },
            message_scene: { source: 'sendToAdmin', ext: [] },
        } as any,
        false,
    );

    return msg.sendMsgEx({ content, ref: false });
}

export async function callWithRetry<T extends (...args: A) => Promise<R>, R, A extends Array<any>>(
    functionCall: (...args: A) => Promise<R>,
    args: Parameters<T>,
    retries = 0,
    errors: any[] = [],
): Promise<RetryResult<R>> {
    try {
        const result = await functionCall(...args);
        return { result, errors };
    } catch (err) {
        if (args[0]?.imageFile)
            args[0].imageFile = { type: 'Buffer', length: args[0].imageFile.length };

        if (err && (err as any).code == 304027 && args && args[0] && args[0].msgId) {
            //message is expired
            retries--;
            args[0].msgId = await redis.get(`lastestMsgId:${botType}`);
        } else log.error(err);
        if (typeof err == 'object') errors.push(JSON.stringify(err));
        else errors.push(String(err));

        const removeParams = () => {
            if (Array.isArray(args[0]?.params)) {
                args[0].params = (args[0]?.params as string[]).filter((v) => v !== '\u200b');
                if (args[0].markdown) args[0].markdown.params = undefined;
            }
        };
        if (
            (err && (err as any).code === 304023) ||
            (err as any)?.message?.includes('push message is waiting for audit now')
        ) {
            removeParams();
            log.error(`等待主动推送\n`, strFormat(args[0]));
            return { result: {} as R, errors };
        }
        if (
            (err && (err as any).code === 304003) ||
            ((err as any)?.msg as string | null)?.includes('url not allowed')
        ) {
            removeParams();
            log.error(`url 不被允许:\n`, strFormat(args[0]));
            throw { errors };
        }
        if (
            (err && (err as any).code === 40054010) ||
            (err as any)?.message?.includes('消息发送失败, 不允许发送url')
        ) {
            removeParams();
            log.error(`不允许发送url\n`, strFormat(args[0]));
            throw { errors };
        }
        if (
            (err && (err as any).code === 40014) ||
            ((err as any)?.msg as string | null)?.includes('file too large')
        ) {
            removeParams();
            log.error(`文件过大\n`, strFormat(args[0]));
            throw { errors };
        }
        if (
            (err && (err as any).code === 304020) ||
            ((err as any)?.msg as string | null)?.includes('file size exceeded')
        ) {
            removeParams();
            log.error(`文件超过大小\n`, strFormat(args[0]));
            throw { errors };
        }
        if (
            (err && (err as any).code === 40034010) ||
            (err as any)?.message?.includes('模版参数中不能含有 markdown 语法')
        ) {
            removeParams();
            log.error(`模版参数中不能含有 markdown 语法\n`, strFormat(args[0]));
            throw { errors };
        }
        if (
            (err && (err as any).code === 304039) ||
            (err as any)?.message?.includes('keyboard unmarshal error')
        ) {
            removeParams();
            log.error(`keyboard发送失败\n`, strFormat(args[0]));
            throw { errors };
        }
        if (
            (err && (err as any).code === 40034005) ||
            (err as any)?.message?.includes('回复消息msg_id已过期')
        ) {
            removeParams();
            log.error(`回复消息msg_id已过期\n`, strFormat(args[0]));
            throw { errors };
        }
        if (retries < config.retryTime - 1) {
            await sleep(100);
            return await callWithRetry(functionCall, args, ++retries, errors);
        } else {
            removeParams();
            log.error(`重试多次未成功 args:\n`, strFormat(args[0]));
            throw { errors };
        }
    }
}

/** 时间字段统一转成 Date，避免新数据字符串与迁移数据 Date 混存 */
function toDate(value: unknown): unknown {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d;
    }
    return value;
}

export async function pushToDB(table: string, data: Record<string, any>) {
    if (!global.mongoDb) return;
    try {
        const doc: Record<string, any> = { ...data };
        if (doc.ts !== undefined) doc.ts = toDate(doc.ts);
        if (doc.timestamp !== undefined) doc.timestamp = toDate(doc.timestamp);
        for (const k of Object.keys(doc)) {
            if (doc[k] === undefined) delete doc[k];
        }
        if (doc._id !== undefined) {
            return await global.mongoDb
                .collection(table)
                .replaceOne({ _id: doc._id }, doc, { upsert: true });
        }
        const primaryKey = ['eventId', 'eId', 'msgId', 'mid', 'id'].find((k) => doc[k] != null);
        if (primaryKey) {
            doc._id = String(doc[primaryKey]);
            return await global.mongoDb
                .collection(table)
                .replaceOne({ _id: doc._id }, doc, { upsert: true });
        } else {
            return await global.mongoDb.collection(table).insertOne(doc);
        }
    } catch (err) {
        log.error(`pushToMongo ${table}`, err);
    }
}

export async function settingUserConfig(
    aid: string,
    types: 'GET',
    data: string[],
): Promise<Record<string, string>>;
export async function settingUserConfig(
    aid: string,
    types: 'SET',
    data: Record<string, string>,
): Promise<Record<string, string>>;
export async function settingUserConfig(
    aid: string,
    types: 'GET' | 'SET',
    data: string[] | Record<string, string>,
): Promise<Record<string, string>> {
    if (types == 'GET' || Array.isArray(data))
        return redis.hmGet(`setting:${aid}`, data as string[]).then((hmData) => {
            const _ret: Record<string, string> = {};
            for (const [index, _hmData] of hmData.entries()) {
                if (_hmData) _ret[(data as string[])[index]] = _hmData;
            }
            return _ret;
        });

    const kv: [string, string][] = [];
    for (const key in data) if (data[key]) kv.push([key, data[key]]);
    return redis.hSet(`setting:${aid}`, kv).then(() => {
        return data;
    });
}

export async function findDirectAidToGid(aid: string, guildId: string): Promise<string> {
    const redisGid = await redis.hGet(`directUid->Gid`, aid).catch((err) => log.error(err));
    if (redisGid) return redisGid;

    const createGid = await client.directMessageApi
        .createDirectMessage({
            source_guild_id: guildId,
            recipient_id: aid,
        })
        .then((res) => {
            return res.data.guild_id;
        })
        .catch((err) => {
            log.error(err);
        });
    if (createGid) {
        await redis.hSet(`directUid->Gid`, aid, createGid);
        return createGid;
    }
    throw 'not found guild and create guild';
}

export function timeConver(ms: number) {
    ms = Number((ms / 1000).toFixed(0));

    if (ms == 0) return '0分钟';
    if (ms < 60) return '不足1分钟';

    const s = ms % 60;
    ms = (ms - s) / 60;

    const m = ms % 60;
    ms = (ms - m) / 60;

    const h = ms % 24;
    ms = (ms - h) / 24;

    return `${ms ? `${ms}天 ` : ``}${h ? `${h}小时 ` : ``}${m ? `${m}分钟 ` : ``}`;
}
