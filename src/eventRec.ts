import fetch from "node-fetch";
import nodemailer from "nodemailer";
import { readFileSync, writeFileSync } from "fs";
import { AvailableIntentsEventsEnum, IChannel, IGuild } from "qq-bot-sdk";
import { loadGuildTree } from "./init";
import { findOpts } from "./libs/findOpts";
import { pushToDB, sendToAdmin } from "./libs/common";
import { IMessageGROUP, IMessageDIRECT, IMessageGUILD, IMessageC2C } from "./libs/IMessageEx";
import config from "../config/config";


async function executeChannel(msg: IMessageDIRECT | IMessageGUILD) {
    try {
        global.redis.set(`lastestMsgId:${botType}`, msg.id, { EX: 4 * 60 });
        if (adminId.includes(msg.author.id) && !devEnv && (await redis.get("devEnv"))) return;
        if (msg instanceof IMessageGUILD && msg.mentions?.find(v => v.bot && v.id != meId && !msg.mentions?.find(m => m.id == meId))) return;

        const opt = await findOpts(msg);
        if (!opt) return;
        if (await isBan(msg)) return;
        if (await redis.sIsMember(`ban:opt:guild`, `${opt.path}:${opt.keyChild}:${msg.guild_id}`))
            return msg.sendMsgExRef({ content: `命令 ${opt.path} ${opt.keyChild} 在该频道未启用` });

        if (global.devEnv) log.debug(`${_path}/src/plugins/${opt.path}:${opt.fnc}`);
        const plugin = await import(`./plugins/${opt.path}.ts`);
        if (typeof plugin[opt.fnc] != "function") log.error(`not found function ${opt.fnc}() at "${global._path}/src/plugins/${opt.path}.ts"`);
        else await (plugin[opt.fnc] as PluginFnc)(msg);

        await pushToDB("executeRecord", {
            mid: msg.id,
            type: String(Object.getPrototypeOf(msg).constructor.name),
            optFather: opt.path,
            optChild: opt.fnc,
            gid: msg.guild_id,
            cid: msg.channel_id,
            cName: (msg as IMessageGUILD).channelName || "",
            aid: msg.author.id,
            aName: msg.author.username,
            seq: msg.seq,
            ts: msg.timestamp,
            content: msg.content,
        });
    } catch (err) {
        await mailerError(msg, err instanceof Error ? err : new Error(stringifyFormat(err)))
            .catch(err => log.error(err));
    }
}

async function executeChat(msg: IMessageGROUP | IMessageC2C) {
    try {
        const opt = await findOpts(msg);
        if (!opt) return;
        if (adminId.includes(msg.author.id) && !devEnv && (await redis.get("devEnv"))) return;
        if (await isBan(msg)) return;
        if (global.devEnv) log.debug(`${_path}/src/plugins/${opt.path}:${opt.fnc}`);

        const plugin = await import(`./plugins/${opt.path}.ts`);
        if (typeof plugin[opt.fnc] != "function") log.error(`not found function ${opt.fnc}() at "${global._path}/src/plugins/${opt.path}.ts"`);
        else await (plugin[opt.fnc] as PluginFnc)(msg);

    } catch (err) {
        await mailerError(msg, err instanceof Error ? err : new Error(JSON.stringify(err)))
            .catch(err => log.error(err));
    }

}

export async function mailerError(msg: any, err: Error) {
    log.error(err);
    if (devEnv) return;

    const host = await redis.hGet("config", "sendMail:host");
    const user = await redis.hGet("config", "sendMail:user");
    const pass = await redis.hGet("config", "sendMail:pass");
    const to = await redis.hGet("config", "sendMail:to");
    if (!host || !user || !pass || !to) return;

    const html = readFileSync(config.errorMessageTemaple).toString()
        .replace("%message%", stringifyFormat(msg))
        .replace("%errorName%", err.name)
        .replace("%errorMessage%", err.message)
        .replace("%errorStack%", err.stack || "");

    // writeFileSync("/tmp/html/index.html", html);

    const transporter = nodemailer.createTransport({
        host,
        port: 465,
        secure: true,
        auth: { user, pass },
    });
    return transporter.sendMail({
        subject: `エラー発生。${err.message}`.slice(0, 60),
        from: `"${botType}" <${user}>`, to, html,
    }).catch(err => log.error(err));
}

async function isBan(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C): Promise<boolean> {
    const t = msg instanceof IMessageGROUP ? "群聊" : (msg instanceof IMessageGUILD ? "频道" : "私聊");
    const isUserBan = await redis.hGet(`ban:use:user`, msg.author.id);
    const isGroupBan = msg instanceof IMessageGROUP ? await redis.hGet(`ban:use:group`, msg.group_id) : undefined;
    const isGuildBan = msg instanceof IMessageGUILD ? await redis.hGet(`ban:use:guild`, msg.guild_id) : undefined;

    if (isUserBan || isGroupBan || isGuildBan) {
        await msg.sendMsgEx({ content: `因「${isUserBan || isGroupBan || isGuildBan}」行为，禁止使用该命令` }).catch(err => log.error(err));
        await sendToAdmin(
            `被封禁${t}检测到使用命令行为\n`
            + ((msg instanceof IMessageGROUP || msg instanceof IMessageC2C) ? `用户: ${msg.author.id}` : `用户: ${msg.author.username} (${msg.author.id})`) + "\n"
            + (msg instanceof IMessageC2C ? `消息列表: ${msg.author.id}` : msg instanceof IMessageGROUP ? `群聊: ${msg.group_id}` : `${"channelName" in msg ? `子频道: ${msg.channelName}` : ">私聊<"} (${msg.channel_id})`)
        ).catch(err => log.error(err));
        return true;
    }
    return false;
}

type PluginFnc = (msg: IMessageDIRECT | IMessageGUILD | IMessageGROUP | IMessageC2C, data?: string | number) => Promise<any>



export async function eventRec<T>(event: IntentMessage.EventRespose<T>) {
    switch (event.eventRootType) {
        case AvailableIntentsEventsEnum.GUILD_MESSAGES:
        case AvailableIntentsEventsEnum.PUBLIC_GUILD_MESSAGES: {
            const data = event.msg as any as IntentMessage.GUILD_MESSAGES__body;
            if (!['AT_MESSAGE_CREATE', 'MESSAGE_CREATE'].includes(event.eventType)) return;
            if (global.devEnv && !adminId.includes(data.author.id)) return;
            if (devEnv) log.debug(event);
            const msg = new IMessageGUILD(data);
            msg.content = msg.content.replaceAll("@彩奈", "<@!5671091699016759820>");
            if (botType == "AronaBot") import("./plugins/AvalonSystem").then(e => e.avalonSystem(msg)).catch(err => mailerError(data, err));
            return executeChannel(msg);
        }

        case AvailableIntentsEventsEnum.DIRECT_MESSAGE: {
            if (event.eventType != 'DIRECT_MESSAGE_CREATE') return;
            const data = event.msg as any as IntentMessage.DIRECT_MESSAGE__body;
            if (global.devEnv && !adminId.includes(data.author.id)) return;
            if (devEnv) log.debug(event);
            const msg = new IMessageDIRECT(data);
            await global.redis.hSet(`directUid->Gid:${meId}`, msg.author.id, msg.guild_id);
            return executeChannel(msg).then(() => import("./plugins/admin").then(e => e.directToAdmin(msg))).catch(err => log.error(err));
        }

        case AvailableIntentsEventsEnum.GROUP_AND_C2C_EVENT: {
            if (devEnv) log.debug(stringifyFormat(event));
            if (event.eventType == IntentEventType.GROUP_AT_MESSAGE_CREATE) {
                const data = event.msg as any as IntentMessage.GROUP_MESSAGE_body;
                if (devEnv && !adminId.includes(data.author.id)) return;
                // if (devEnv) log.debug(event);
                const msg = new IMessageGROUP(data);
                return executeChat(msg);
            } else if (event.eventType == IntentEventType.C2C_MESSAGE_CREATE) {
                const data = event.msg as any as IntentMessage.C2C_MESSAGE_body;
                if (devEnv && !adminId.includes(data.author.id)) return;

                const msg = new IMessageC2C(data);
                return executeChat(msg);
            } else if ([IntentEventType.GROUP_DEL_ROBOT, IntentEventType.GROUP_ADD_ROBOT].includes(event.eventType)) {
                const data = event.msg as IntentMessage.GROUP_ROBOT;
                log.info(`已被 ${data.op_member_openid} ${event.eventType} 群聊 ${data.group_openid}`);
            }
            return;
        }
        case AvailableIntentsEventsEnum.GUILDS: {
            const data = ["GUILD_CREATE", "GUILD_UPDATE"].includes(event.eventType) ?
                (event.msg as IGuild) :
                (["CHANNEL_CREATE", "CHANNEL_UPDATE"].includes(event.eventType) ? (event.msg as IChannel) : null);
            if (!data) return;
            log.mark(`重新加载频道树中: ${event.eventType} ${data.name}(${data.id})`);
            return loadGuildTree(data).then(() => {
                log.mark(`频道树部分加载完毕`);
            }).catch(err => {
                log.error(`频道树部分加载失败`, err);
            });
        }
        case AvailableIntentsEventsEnum.GUILD_MEMBERS: {
            if (botType != "AronaBot") return;
            import("./plugins/admin").then(module => module.updateEventId(event as IntentMessage.GUILD_MEMBERS)).catch(err => log.error(err));
            if (devEnv) return;
            const msg = (event as IntentMessage.GUILD_MEMBERS).msg;
            if (msg.user.id != "15874984758683127001") return pushToDB("GUILD_MEMBERS", {
                type: event.eventType,
                eId: event.eventId,
                aId: msg.user.id,
                aAvatar: msg.user.avatar,
                aName: msg.user.username,
                nick: msg.nick,
                gid: msg.guild_id,
                jts: msg.joined_at,
                cts: new Date().toDBString(),
                opUserId: msg.op_user_id || "",
                roles: (msg.roles || []).join() || "",
            });
            else return;
        }

        case AvailableIntentsEventsEnum.GUILD_MESSAGE_REACTIONS: {
            if (botType != "AronaBot") return;
            const msg = (event as IntentMessage.GUILD_MESSAGE_REACTIONS).msg;
            if (global.devEnv && !adminId.includes(msg.user_id)) return;
            await import("./plugins/roleAssign").then(module => module.roleAssign(event as IntentMessage.GUILD_MESSAGE_REACTIONS)).catch(err => {
                log.error(err);
                log.error(event);
                return sendToAdmin(
                    `roleAssign 失败` +
                    `\n用户: ${msg.user_id}` +
                    `\n频道: ${saveGuildsTree[msg.guild_id].name}(${msg.guild_id})` +
                    `\n子频道: ${saveGuildsTree[msg.guild_id]?.channels[msg.channel_id]?.name}(${msg.channel_id})` +
                    `\n目标消息: ${msg.target.id} -> ${msg.target.type}` +
                    `\n表情: ${msg.emoji.type == 2 ? emojiMap[msg.emoji.id] : `<emoji:${msg.emoji.id}>`}(${msg.emoji.id}) -> ${msg.emoji.type}`
                );
            }).catch(() => { });

            await pushToDB("GUILD_MESSAGE_REACTIONS", {
                cid: msg.channel_id,
                emojiId: msg.emoji.id,
                emojiType: msg.emoji.type,
                gid: msg.guild_id,
                targetId: msg.target.id,
                targetType: msg.target.type,
                aid: msg.user_id,
            }).catch(err => {
                log.error(err);
                return sendToAdmin(`error: pushToDB GUILD_MESSAGE_REACTIONS`);
            }).catch(() => { });

            if (adminId.includes(msg.user_id) && msg.emoji.id == "55" && msg.emoji.type == 1) return client.messageApi.deleteMessage(msg.channel_id, msg.target.id).catch(err => {
                log.error(err);
            });
        }

        case AvailableIntentsEventsEnum.FORUMS_EVENT: {
            const { eventId, msg } = event as IntentMessage.FORUMS_EVENT;
            const aid = msg.author_id;
            const uidMatch = /:(?<uid>\d+)_/.exec(eventId)?.groups;
            if (!aid || !uidMatch || !uidMatch.uid || uidMatch.uid == "0") return;

            await redis.hSet("guild:aid->uid", aid, uidMatch.uid);
            break;
        }
        case AvailableIntentsEventsEnum.INTERACTION: {
            if (await redis.get("devEnv") && !devEnv) return;

            const { msg } = event as IntentMessage.INTERACTION;
            // if (devEnv) log.debug(event, msg.data);
            if (!("group_openid" in msg)) return;

            const { button_id: buttonId } = msg.data.resolved;
            const [authKey = "", commandKey = ""] = buttonId.split(":");
            if (authKey != config.groupPush.authKey) return;

            const interaction = await import('./plugins/interaction');
            const func = interaction.commandMap[commandKey];
            if (func) await func(event as IntentMessage.INTERACTION).catch(async (err: Error) => {
                try {
                    return await mailerError(event, err);
                } catch (err_1) {
                    return log.error(err_1);
                }
            });


            // await client.interactionApi.putInteraction(msg.id, { code: 0 }).then(data => {
            //     log.debug(data.data);
            // }).catch(err => {
            //     log.error(err);
            // }); //  0成功,1操作失败,2操作频繁,3重复操作,4没有权限,5仅管理员操作


            break;
        }
    }
}


export const emojiMap: Record<string, string> = {
    "9728": "☀",
    "9749": "☕",
    "9786": "☺",
    "10024": "✨",
    "10060": "❌",
    "10068": "❔",
    "127801": "🌹",
    "127817": "🍉",
    "127822": "🍎",
    "127827": "🍓",
    "127836": "🍜",
    "127838": "🍞",
    "127847": "🍧",
    "127866": "🍺",
    "127867": "🍻",
    "127881": "🎉",
    "128027": "🐛",
    "128046": "🐮",
    "128051": "🐳",
    "128053": "🐵",
    "128074": "👊",
    "128076": "👌",
    "128077": "👍",
    "128079": "👏",
    "128089": "👙",
    "128102": "👦",
    "128104": "👨",
    "128147": "💓",
    "128157": "💝",
    "128164": "💤",
    "128166": "💦",
    "128168": "💨",
    "128170": "💪",
    "128235": "📫",
    "128293": "🔥",
    "128513": "😁",
    "128514": "😂",
    "128516": "😄",
    "128522": "😊",
    "128524": "😌",
    "128527": "😏",
    "128530": "😒",
    "128531": "😓",
    "128532": "😔",
    "128536": "😘",
    "128538": "😚",
    "128540": "😜",
    "128541": "😝",
    "128557": "😭",
    "128560": "😰",
    "128563": "😳",
}
