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

            const opt = await findOpts(msg, msg.channel_id);
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

            (await import("./plugins/admin")).directToAdmin(msg);

            const opt = await findOpts(msg, msg.channel_id);
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
});

type PluginFnc = (msg: IMessageEx, data?: string | number) => Promise<any>