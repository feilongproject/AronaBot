import { IMessageEx } from "./IMessageEx";

export async function findOpts(msg: IMessageEx,): Promise<{ path: string; fnc: string; data?: string }> {
    if (!msg.content) return { path: "err", fnc: "err" };

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

            if (allowKeys[0] == "all" || msg.messageType == "DIRECT" || (function () {
                for (const allowKey of allowKeys)
                    for (const channel of channelAllows[allowKey])
                        if (channel.id == msg.channel_id) return true;
            })()) return {
                path: keyFather,
                fnc: opt.fnc,
                data: opt.data,
            };
        }

    return {
        path: "err",
        fnc: "err",
    };
}