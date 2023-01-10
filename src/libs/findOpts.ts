import { IMessageGUILD, IMessageDIRECT } from "./IMessageEx";

export async function findOpts(msg: IMessageGUILD | IMessageDIRECT): Promise<{ path: string; fnc: string; data?: string } | string | null> {
    if (!msg.content) return null;

    const configOpt = await import("../../config/opts.json");
    const commandFathers: {
        [keyFather: string]: {
            [keyChild: string]: {
                reg: string;
                fnc: string;
                channelAllows?: string[];
                data?: string;
                type: string[],
                describe: string;
            }
        }
    } = configOpt.command;
    const channelAllows: {
        [allowKeys: string]: {
            id: string;
            name: string;
        }[];
    } = configOpt.channelAllows;

    for (const keyFather in commandFathers)
        for (const keyChild in commandFathers[keyFather]) {
            const opt = commandFathers[keyFather][keyChild];
            const allowKeys = opt.channelAllows || ["common"];
            // if (devEnv) allowKeys.push("dev");
            if (!opt.type.includes(msg.messageType)) continue;
            if (!RegExp(opt.reg).test(msg.content.replace(/<@!\d*>/g, "").trim())) continue;
            const channelAllow = () => {
                for (const allowKey of allowKeys) for (const channel of channelAllows[allowKey]) if (channel.id == msg.channel_id) return true;
            }
            if (msg.guild_id == "5237615478283154023" || msg.messageType == "DIRECT" || allowKeys[0] == "all" || channelAllow()) {
                if (await redis.hExists("blackList", msg.author.id)) return `黑名单用户！如有异议联系<@${adminId[0]}>`;
                else return { path: keyFather, ...opt, };
            }
        }

    return null;
}
