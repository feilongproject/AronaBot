import { loadGuildTree } from "./init";
import { pushToDB, sendToAdmin } from "./libs/common";
import { findOpts } from "./libs/findOpts";
import { IMessageDIRECT, IMessageGUILD } from "./libs/IMessageEx";

async function execute(msg: IMessageDIRECT | IMessageGUILD) {
    try {
        global.redis.set("lastestMsgId", msg.id, { EX: 4 * 60 });
        if (adminId.includes(msg.author.id) && !devEnv && (await redis.get("devEnv"))) return;

        const opt = await findOpts(msg);
        if (!opt) return;
        if (typeof opt == "string") return msg.sendMsgExRef({ content: opt });
        if (await redis.sIsMember(`ban:opt:guild`, `${opt.path}:${opt.keyChild}:${msg.guild_id}`))
            return msg.sendMsgExRef({ content: `命令 ${opt.path} ${opt.keyChild} 在该频道未启用` });

        if (global.devEnv) log.debug(`${_path}/src/plugins/${opt.path}:${opt.fnc}`);

        const plugin = await import(`./plugins/${opt.path}.ts`);
        if (typeof plugin[opt.fnc] != "function") log.error(`not found function ${opt.fnc}() at "${global._path}/src/plugins/${opt.path}.ts"`);
        else await (plugin[opt.fnc] as PluginFnc)(msg).catch(err => log.error(err));

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
        log.error(err);
    }
}

type PluginFnc = (msg: IMessageDIRECT | IMessageGUILD, data?: string | number) => Promise<any>



export async function eventRec<T>(event: IntentMessage.EventRespose<T>) {
    switch (event.eventRootType) {
        case "GUILD_MESSAGES": {
            if (!['AT_MESSAGE_CREATE', 'MESSAGE_CREATE'].includes(event.eventType)) return;
            const data = event.msg as any as IntentMessage.GUILD_MESSAGES__body;
            if (global.devEnv && !adminId.includes(data.author.id)) return;
            const msg = new IMessageGUILD(data);
            msg.content = msg.content.replaceAll("@BA彩奈", "<@!5671091699016759820>");
            return execute(msg).then(() => import("./plugins/AvalonSystem").then(e => e.avalonSystem(msg)));
        }

        case "DIRECT_MESSAGE": {
            if (event.eventType != 'DIRECT_MESSAGE_CREATE') return;
            const data = event.msg as any as IntentMessage.DIRECT_MESSAGE__body;
            if (global.devEnv && !adminId.includes(data.author.id)) return;
            const msg = new IMessageDIRECT(data);
            global.redis.hSet(`directUid->Gid`, msg.author.id, msg.guild_id);
            return execute(msg).then(() => import("./plugins/admin").then(e => e.directToAdmin(msg)));
        }
        case "GUILDS": {
            log.mark(`重新加载频道树中`);
            return loadGuildTree().then(() => {
                log.mark(`频道树加载完毕`);
            }).catch(err => {
                log.error(`频道树加载失败`, err);
            });
        }
        case "GUILD_MEMBERS": {
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

        case "GUILD_MESSAGE_REACTIONS": {
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

        case "FORUMS_EVENT":
            break;

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