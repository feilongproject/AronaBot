import { IMessageGUILD, IMessageDIRECT, IMessageGROUP, IMessageC2C, MessageType } from "./IMessageEx";

export async function findOpts(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C): Promise<{ path: string; fnc: string; keyChild: string; data?: string } | null> {
    if (typeof msg.content !== "string") return null;

    const configOpt = (await import("../../config/opts")).default;
    const commandFathers: Record<string, Record<string, {
        reg: string;
        fnc: string;
        channelAllows?: string[];
        data?: string;
        type: string[],
        describe: string;
    }>> = configOpt.command;
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
            if ((typeof opt == "function") || !opt.type.includes(msg.messageType)) continue;
            if (!RegExp(opt.reg).test(msg.content.replace(/<@!\d*>/g, "").trim())) continue;

            if (msg instanceof IMessageGROUP || msg instanceof IMessageC2C) {
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
