import { loadGuildTree } from "./init";
import { pushToDB } from "./libs/common";
import { findOpts } from "./libs/findOpts";
import { IMessageDIRECT, IMessageGUILD } from "./libs/IMessageEx";

async function execute(msg: IMessageDIRECT | IMessageGUILD) {
    try {
        global.redis.set("lastestMsgId", msg.id, { EX: 4 * 60 });
        const opt = await findOpts(msg);
        if (!opt) return;

        if (adminId.includes(msg.author.id) && !devEnv && (await redis.get("devEnv"))) return;
        if (typeof opt == "string") return msg.sendMsgExRef({ content: opt });
        if (global.devEnv) log.debug(`${_path}/src/plugins/${opt.path}:${opt.fnc}`);

        const plugin = await import(`./plugins/${opt.path}.ts`);
        if (typeof plugin[opt.fnc] != "function") return log.error(`not found function ${opt.fnc}() at "${global._path}/src/plugins/${opt.path}.ts"`);
        else return (plugin[opt.fnc] as PluginFnc)(msg).catch(err => {
            log.error(err);
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
            return execute(msg).then(async () => import("./plugins/AvalonSystem").then(e => e.avalonSystem(msg)));
        }

        case "DIRECT_MESSAGE": {
            if (event.eventType != 'DIRECT_MESSAGE_CREATE') return;
            const data = event.msg as any as IntentMessage.DIRECT_MESSAGE__body;
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
            if (devEnv) return;
            const msg = event.msg as any as IntentMessage.GUILD_MEMBERS__body;
            return pushToDB("GUILD_MEMBERS", {
                type: event.eventType,
                eId: event.eventId,
                aId: msg.user.id,
                aAvatar: msg.user.avatar,
                aName: msg.user.username,
                nick: msg.nick,
                gid: msg.guild_id,
                jts: msg.joined_at,
                cts: new Date().toDBString(),
            });
        }

        case "GUILD_MESSAGE_REACTIONS": {
            const msg = event.msg as any as IntentMessage.GUILD_MESSAGE_REACTIONS__body;
            if (!(msg.user_id == adminId[0] && msg.emoji.id == "10060" && msg.emoji.type == 2)) return;
            return client.messageApi.deleteMessage(msg.channel_id, msg.target.id).catch(err => {
                log.error(err);
            });
        }

        case "FORUMS_EVENT":
            break;

    }
}
