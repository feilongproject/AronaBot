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
            if (!opt.type.includes(msg.messageType)) continue;
            if (!RegExp(opt.reg).test(msg.content.replace(/<@!\d*>/g, "").trim())) continue;
            const channelAllow = () => {
                for (const allowKey of allowKeys) for (const channel of channelAllows[allowKey]) if (channel.id == msg.channel_id) return true;
            }
            if (allowKeys[0] == "all" || msg.messageType == "DIRECT" || channelAllow()) {
                if (await redis.hExists("blackList:uid", msg.author.id)) return `黑名单用户！如有异议联系<@${adminId[0]}>`;
                else return { path: keyFather, ...opt, };

            }
        }

    return null;
}
