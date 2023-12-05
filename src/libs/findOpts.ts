import { IMessageGUILD, IMessageDIRECT, IMessageGROUP, MessageType } from "./IMessageEx";

export async function findOpts(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP): Promise<{ path: string; fnc: string; keyChild: string; data?: string } | string | null> {
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
            const allowChannels = opt.channelAllows || ["common"];
            // if (devEnv) allowKeys.push("dev");
            if (!opt.type.includes(msg.messageType)) continue;
            if (!RegExp(opt.reg).test(msg.content.replace(/<@!\d*>/g, "").trim())) continue;

            if (msg instanceof IMessageGROUP) {
                return { path: keyFather, keyChild, ...opt };
            }

            const channelAllow: () => boolean = () => {
                for (const allowChannelKey of allowChannels) for (const channel of channelAllows[allowChannelKey])
                    if (channel.id == msg.channel_id) return true;
                return false;
            }
            if (devEnv || msg.guild_id == "5237615478283154023" || msg.messageType == MessageType.DIRECT || allowChannels[0] == "all" || channelAllow()) {
                return { path: keyFather, keyChild, ...opt };
            }
        }

    return null;
}
