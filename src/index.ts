import { init } from './init';
import { findOpts } from './libs/findOpts';
import { IMessageEx } from './libs/IMessageEx';

init().then(() => {

    global.ws.on('GUILD_MESSAGES', async (data: IntentMessage) => {
        if (data.eventType == 'MESSAGE_CREATE' && global.devEnv && !adminId.includes(data.msg.author.id)) return;
        if (data.eventType == 'MESSAGE_CREATE') {
            const msg = new IMessageEx(data.msg, "GUILD");// = data.msg as any;
            execute(msg);
        }
    });

    global.ws.on("DIRECT_MESSAGE", async (data: IntentMessage) => {
        if (data.eventType == 'DIRECT_MESSAGE_CREATE') {
            const msg = new IMessageEx(data.msg, "DIRECT");// = data.msg as any;
            global.redis.hSet(`directUid->Gid`, msg.author.id, msg.guild_id);
            (await import("./plugins/admin")).directToAdmin(msg);
            execute(msg);
        }
    });
});


async function execute(msg: IMessageEx) {
    try {
        global.redis.set("lastestMsgId", msg.id, { EX: 4 * 60 });
        const opt = await findOpts(msg);
        if (opt.path == "err") return;
        if (global.devEnv) log.debug(`./plugins/${opt.path}:${opt.fnc}`);
        const plugin = await import(`./plugins/${opt.path}.ts`);

        if (typeof plugin[opt.fnc] != "function") return log.error(`not found function ${opt.fnc}() at "${global._path}/src/plugins/${opt.path}.ts"`);
        else return (plugin[opt.fnc] as PluginFnc)(msg).catch(err => {
            log.error(err);
        });
    } catch (err) {
        log.error(err);
    }
}

type PluginFnc = (msg: IMessageEx, data?: string | number) => Promise<any>