import axios from 'axios';
import { AvailableIntentsEventsEnum, IChannel, IGuild } from 'qq-bot-sdk';
import { loadGuildTree } from './init';
import { mailerError } from './libs/mailer';
import { pushToDB, sendToAdmin } from './libs/common';
import { IMessageGROUP, IMessageDIRECT, IMessageGUILD, IMessageC2C } from './libs/IMessageEx';
import config from '../config/config';

type PluginFnc = (
    msg: IMessageDIRECT | IMessageGUILD | IMessageGROUP | IMessageC2C,
    data?: string | number,
) => Promise<any>;

async function executeChannel(msg: IMessageDIRECT | IMessageGUILD) {
    try {
        global.redis.set(`lastestMsgId:${botType}`, msg.id, { EX: 4 * 60 });
        if (adminId.includes(msg.author.id) && !devEnv && (await redis.get('devEnv'))) return;
        if (
            msg instanceof IMessageGUILD &&
            msg.mentions?.find(
                (v) => v.bot && v.id != meId && !msg.mentions?.find((m) => m.id == meId),
            )
        )
            return;

        global.commandConfig = (await import('../config/opts')).default;
        const { opts } = msg;
        if (!opts) return;
        if (await isBan(msg)) return;
        if (await redis.sIsMember(`ban:opt:guild`, `${opts.path}:${opts.keyChild}:${msg.guild_id}`))
            return msg.sendMsgExRef({
                content: `命令 ${opts.path} ${opts.keyChild} 在该频道未启用`,
            });

        if (global.devEnv) log.debug(`${_path}/src/plugins/${opts.path}:${opts.fnc}`);
        const plugin = await import(`./plugins/${opts.path}.ts`);
        if (typeof plugin[opts.fnc] != 'function')
            log.error(
                `not found function ${opts.fnc}() at "${global._path}/src/plugins/${opts.path}.ts"`,
            );
        else await (plugin[opts.fnc] as PluginFnc)(msg);

        await pushToDB('executeRecord', {
            mid: msg.id,
            type: String(Object.getPrototypeOf(msg).constructor.name),
            optFather: opts.path,
            optChild: opts.fnc,
            gid: msg.guild_id,
            cid: msg.channel_id,
            cName: (msg as IMessageGUILD).channelName || '',
            aid: msg.author.id,
            aName: msg.author.username,
            seq: msg.seq,
            ts: msg.timestamp,
            content: msg.content,
        });
    } catch (err) {
        await mailerError(msg, err instanceof Error ? err : new Error(strFormat(err))).catch(
            (err) => log.error(err),
        );
    }
}

async function executeChat(msg: IMessageGROUP | IMessageC2C) {
    try {
        global.commandConfig = (await import('../config/opts')).default;
        aiAllow(msg);
        const { opts } = msg;
        if (!opts) return;
        if (adminId.includes(msg.author.id) && !devEnv && (await redis.get('devEnv'))) return;
        if (await isBan(msg)) return;
        if (global.devEnv) log.debug(`${_path}/src/plugins/${opts.path}:${opts.fnc}`);

        const plugin = await import(`./plugins/${opts.path}.ts`);
        if (typeof plugin[opts.fnc] != 'function')
            log.error(
                `not found function ${opts.fnc}() at "${global._path}/src/plugins/${opts.path}.ts"`,
            );
        else await (plugin[opts.fnc] as PluginFnc)(msg);
    } catch (err) {
        await mailerError(msg, err instanceof Error ? err : new Error(JSON.stringify(err))).catch(
            (err) => log.error(err),
        );
    }
}

export async function eventRec<T>(event: IntentMessage.EventRespose<T>) {
    if (
        (await redis.exists(`received:${event.eventType}:${event.eventId}`)) &&
        !devEnv &&
        (event.msg as any as IntentMessage.GROUP_MESSAGE_body)?.isOffical != false
    )
        return;
    await redis.setEx(`received:${event.eventType}:${event.eventId}`, 60, '1');

    switch (event.eventRootType) {
        case AvailableIntentsEventsEnum.GUILD_MESSAGES:
        case AvailableIntentsEventsEnum.PUBLIC_GUILD_MESSAGES: {
            const data = event.msg as any as IntentMessage.GUILD_MESSAGES__body;
            if (!['AT_MESSAGE_CREATE', 'MESSAGE_CREATE'].includes(event.eventType)) return;
            if (global.devEnv && !adminId.includes(data.author.id)) return;
            if (devEnv) log.debug(event);
            const msg = new IMessageGUILD(data);
            msg.content = msg.content.replaceAll('@彩奈', '<@!5671091699016759820>');
            if (botType == 'AronaBot')
                import('./plugins/AvalonSystem')
                    .then((e) => e.avalonSystem(msg))
                    .catch((err) => mailerError(data, err));
            return executeChannel(msg);
        }

        case AvailableIntentsEventsEnum.DIRECT_MESSAGE: {
            if (event.eventType != 'DIRECT_MESSAGE_CREATE') return;
            const data = event.msg as any as IntentMessage.DIRECT_MESSAGE__body;
            if (global.devEnv && !adminId.includes(data.author.id)) return;
            if (devEnv) log.debug(event);
            const msg = new IMessageDIRECT(data);
            await global.redis.hSet(`directUid->Gid:${meId}`, msg.author.id, msg.guild_id);
            return executeChannel(msg)
                .then(() => import('./plugins/admin').then((e) => e.directToAdmin(msg)))
                .catch((err) => log.error(err));
        }

        case AvailableIntentsEventsEnum.GROUP_AND_C2C_EVENT: {
            if (devEnv) log.debug(strFormat(event));
            if (event.eventType == IntentEventType.GROUP_AT_MESSAGE_CREATE) {
                const data = event.msg as any as IntentMessage.GROUP_MESSAGE_body;
                if (devEnv && !adminId.includes(data.author.id)) return;
                const msg = new IMessageGROUP(data, true, data.isOffical ?? true);
                return executeChat(msg);
            } else if (event.eventType == IntentEventType.C2C_MESSAGE_CREATE) {
                const data = event.msg as any as IntentMessage.C2C_MESSAGE_body;
                if (devEnv && !adminId.includes(data.author.id)) return;

                const msg = new IMessageC2C(data);
                return executeChat(msg);
            } else if (
                [IntentEventType.GROUP_DEL_ROBOT, IntentEventType.GROUP_ADD_ROBOT].includes(
                    event.eventType,
                )
            ) {
                const data = event.msg as IntentMessage.GROUP_ROBOT;
                log.info(
                    `已被 ${data.op_member_openid} ${event.eventType} 群聊 ${data.group_openid}`,
                );
            }
            return;
        }
        case AvailableIntentsEventsEnum.GUILDS: {
            const data = ['GUILD_CREATE', 'GUILD_UPDATE'].includes(event.eventType)
                ? (event.msg as IGuild)
                : ['CHANNEL_CREATE', 'CHANNEL_UPDATE'].includes(event.eventType)
                  ? (event.msg as IChannel)
                  : null;
            if (!data) return;
            log.mark(`重新加载频道树中: ${event.eventType} ${data.name}(${data.id})`);
            return loadGuildTree(data)
                .then(() => {
                    log.mark(`频道树部分加载完毕`);
                })
                .catch((err) => {
                    log.error(`频道树部分加载失败`, err);
                });
        }
        case AvailableIntentsEventsEnum.GUILD_MEMBERS: {
            if (botType != 'AronaBot') return;
            if (devEnv) log.debug('GUILD_MEMBERS', event);
            import('./plugins/admin')
                .then((module) => module.updateEventId(event as IntentMessage.GUILD_MEMBERS))
                .catch((err) => log.error(err));
            if (devEnv) return;
            const msg = (event as IntentMessage.GUILD_MEMBERS).msg;
            if (msg.user.id != '15874984758683127001')
                return pushToDB('GUILD_MEMBERS', {
                    type: event.eventType,
                    eId: event.eventId,
                    aId: msg.user.id,
                    aAvatar: msg.user.avatar,
                    aName: msg.user.username,
                    nick: msg.nick,
                    gid: msg.guild_id,
                    jts: msg.joined_at,
                    cts: new Date().toDBString(),
                    opUserId: msg.op_user_id || '',
                    roles: (msg.roles || []).join() || '',
                });
            else return;
        }

        case AvailableIntentsEventsEnum.GUILD_MESSAGE_REACTIONS: {
            if (botType != 'AronaBot') return;
            const msg = (event as IntentMessage.GUILD_MESSAGE_REACTIONS).msg;
            if (global.devEnv && !adminId.includes(msg.user_id)) return;

            await pushToDB('GUILD_MESSAGE_REACTIONS', {
                cid: msg.channel_id,
                emojiId: msg.emoji.id,
                emojiType: msg.emoji.type,
                gid: msg.guild_id,
                targetId: msg.target.id,
                targetType: msg.target.type,
                aid: msg.user_id,
            })
                .catch((err) => {
                    log.error(err);
                    return sendToAdmin(`error: pushToDB GUILD_MESSAGE_REACTIONS`);
                })
                .catch(() => {});

            if (adminId.includes(msg.user_id) && msg.emoji.id == '55' && msg.emoji.type == 1)
                return client.messageApi
                    .deleteMessage(msg.channel_id, msg.target.id)
                    .catch((err) => {
                        log.error(err);
                    });
        }

        case AvailableIntentsEventsEnum.FORUMS_EVENT: {
            const { eventId, msg } = event as IntentMessage.FORUMS_EVENT; // FORUM_THREAD_CREATE FORUM_POST_CREATE FORUM_REPLY_CREATE
            // if (devEnv) log.debug(event);
            const aid = msg.author_id;
            const uidMatch = /:(?<uid>\d+)_/.exec(eventId)?.groups;
            if (!aid || !uidMatch || !uidMatch.uid || uidMatch.uid == '0') return;

            await redis.hSet('guild:aid->uid', aid, uidMatch.uid);

            if (!adminId.includes(aid)) return;

            if (event.eventType == 'FORUM_POST_CREATE') {
                /** FORUM_POST_CREATE
                post_info: {
                    content: '{"paragraphs":[{"elems":[{"text":{"text":"123456"},"type":1}],"props":{}}]}',
                    date_time: '2024-03-22T15:07:37+08:00',
                    post_id: 'c_392efd65c4d10c001441152193843183750X60',
                    thread_id: 'B_bb26fd65519f03001441152189223925810X60'
                } */

                /**
                 * FORUM_REPLY_CREATE
                 * ```
                 * reply_info: {
                 *     content: '{"paragraphs":[{"elems":[{"text":{"text":"123456"},"type":1}],"props":{}}]}',
                 *     date_time: '2024-03-22T15:11:20+08:00',
                 *     post_id: 'c_392efd65c4d10c001441152193843183750X60',
                 *     reply_id: 'r_182ffd65b97401001441152193843183750X60',
                 *     thread_id: 'B_bb26fd65519f03001441152189223925810X60'
                 * }
                 * ```
                 */
                const threadContent: PostInfo.Root = await axios({
                    url: `https://api.sgroup.qq.com/channels/${msg.channel_id}/threads/${msg.post_info?.thread_id}`,
                    headers: {
                        Authorization: `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`,
                    },
                })
                    .then((res) => res.data)
                    .then((json) => JSON.parse(json.thread.thread_info.content));

                log.debug(
                    threadContent.paragraphs.find((v) =>
                        v.elems.find((v) => v.text?.text.includes('举报晒卡')),
                    ),
                );
            }

            return;
        }
        case AvailableIntentsEventsEnum.INTERACTION: {
            if ((await redis.get('devEnv')) && !devEnv) return;

            const { msg, eventId } = event as IntentMessage.INTERACTION;
            // if (devEnv) log.debug(event, msg.data);

            const groupId = msg?.group_openid;
            if (!groupId) return;
            const groupUid = config.bots[botType].groupMap[groupId];
            if (!groupUid) return;

            const syncButtonId = await redis.get(`syncGroupButtonId:${botType}:${groupUid}`);
            const { button_id: buttonId } = msg.data.resolved;
            if (buttonId !== syncButtonId) return;
            await redis.setEx(`groupLastestEventId:${botType}:${groupId}`, 60 * 3.5, eventId);
            // const [authKey = "", commandKey = ""] = buttonId.split(":");
            // if (authKey != config.groupPush.authKey) return;

            // const interaction = await import('./plugins/interaction');
            // const func = interaction.commandMap[commandKey];
            // if (func) await func(event as IntentMessage.INTERACTION).catch(async (err: Error) => {
            //     try {
            //         return await mailerError(event, err);
            //     } catch (err_1) {
            //         return log.error(err_1);
            //     }
            // });

            // await client.interactionApi.putInteraction(msg.id, { code: 0 }).then(data => {
            //     log.debug(data.data);
            // }).catch(err => {
            //     log.error(err);
            // }); //  0成功,1操作失败,2操作频繁,3重复操作,4没有权限,5仅管理员操作

            break;
        }
    }
}

async function isBan(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
): Promise<boolean> {
    const t =
        msg instanceof IMessageGROUP ? '群聊' : msg instanceof IMessageGUILD ? '频道' : '私聊';
    const isUserBan = await redis.hGet(`ban:use:user`, msg.author.id);
    const isGroupBan =
        msg instanceof IMessageGROUP ? await redis.hGet(`ban:use:group`, msg.group_id) : undefined;
    const isGuildBan =
        msg instanceof IMessageGUILD ? await redis.hGet(`ban:use:guild`, msg.guild_id) : undefined;

    if (isUserBan || isGroupBan || isGuildBan) {
        await msg
            .sendMsgEx({
                content: `因「${isUserBan || isGroupBan || isGuildBan}」行为，禁止使用该命令`,
            })
            .catch((err) => log.error(err));
        await sendToAdmin(
            `被封禁${t}检测到使用命令行为\n` +
                (msg instanceof IMessageGROUP || msg instanceof IMessageC2C
                    ? `用户: ${msg.author.id}`
                    : `用户: ${msg.author.username} (${msg.author.id})`) +
                '\n' +
                (msg instanceof IMessageC2C
                    ? `消息列表: ${msg.author.id}`
                    : msg instanceof IMessageGROUP
                      ? `群聊: ${msg.group_id}`
                      : `${'channelName' in msg ? `子频道: ${msg.channelName}` : '>私聊<'} (${msg.channel_id})`),
        ).catch((err) => log.error(err));
        return true;
    }
    return false;
}

function aiAllow(msg: IMessageGROUP | IMessageC2C) {
    const allowGroup = [
        'E06A1951FA9B96870654B7919DCF2F5C',
        'C677AE4F115CC3FB4ED3AA1CCEF6ABC1',
        '2EA07C40CCAA6E3358A2DB5EA5527D8A',
        'FCD8D4FF03575F550D495003F48A3D01',
    ];
    if (!(msg instanceof IMessageGROUP) || msg.opts) return;
    if (!allowGroup.includes(msg.group_id)) return;
    if (/^[0-9a-zA-Z\/<>@!]+$/.test(msg.content)) return;

    msg.opts = {
        path: 'chatbot',
        fnc: 'chatbot',
        keyChild: 'chatbot',
    };
}
