import { init } from './init';
import { findOpts } from './libs/findOpts';
import { IMessageEx } from './libs/IMessageEx';

init().then(() => {

    global.ws.on('GUILD_MESSAGES', async (data: IntentMessage) => {

        if (data.eventType == 'MESSAGE_CREATE' && global.devEnv && data.msg.author.id != adminId) { return };
        if (data.eventType == 'MESSAGE_CREATE') {
            const msg = new IMessageEx(data.msg, "GUILD");// = data.msg as any;
            global.redis.set("lastestMsgId", msg.id, { EX: 5 * 60 });
            //if (msg.author.id != adminId) return;//break debug

            var _content = msg.content ? msg.content.replace(/<@!\d*>/g, "").trim() : null;
            if (!_content) return;
            while (_content.includes("  ")) _content = _content.replace("  ", " ");
            const content = _content;
            const opts = content.trim().split(" ");
            const opt = await findOpts(opts[0], msg.channel_id);
            if (opt.path == "err") return;
            if (global.devEnv) log.debug(`./plugins/${opt.path}:${opt.fnc}`);

            try {
                const plugin = await import(`./plugins/${opt.path}.ts`);
                if (typeof plugin[opt.fnc] == "function") {
                    (plugin[opt.fnc] as PluginFnc)(msg, opt.data).catch(err => {
                        log.error(err);
                    });
                } else {
                    log.error(`not found function ${opt.fnc}() at "${global._path}/src/plugins/${opt.path}.ts"`);
                }
            } catch (err) {
                log.error(err);
            }
        }
    });

    global.ws.on("DIRECT_MESSAGE", async (data: IntentMessage) => {

        if (data.eventType == 'DIRECT_MESSAGE_CREATE') {
            const msg = new IMessageEx(data.msg, "DIRECT");// = data.msg as any;
            global.redis.set("lastestMsgId", msg.id, { EX: 5 * 60 });
            global.redis.hSet(`directUid->Gid`, msg.author.id, msg.guild_id);
            if (msg.author.id == adminId) {
                //log.debug(`refMid:${msg.message_reference?.message_id}`);
                const refMsgGid = await redis.hGet(`directMid->Gid`, msg.message_reference?.message_id || `0`);
                //log.debug(refMsgGid);
                if (!refMsgGid) return;
                return msg.sendMsgEx({
                    content: msg.content,
                    guildId: refMsgGid,
                });
            }

            return msg.sendMsgEx({
                content: `用户：${msg.author.username}发送了一条信息` +
                    `\n用户id：${msg.author.id}` +
                    `\n源频道：${msg.src_guild_id}` +
                    `\n内容：${msg.content}`,
                guildId: await global.redis.hGet(`directUid->Gid`, adminId),
            }).then((m) => {
                return redis.hSet(`directMid->Gid`, m.data.id, msg.guild_id);
            });

        }
    });
});

type PluginFnc = (msg: IMessageEx, data?: string | number) => Promise<any>