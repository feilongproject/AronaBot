import { IMessageEx } from "./IMessageEx";

export async function findOpts(msg: IMessageEx, channelId: string): Promise<{ path: string; fnc: string; data?: string }> {
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
            if (!opt.type.includes(msg.messageType)) continue;
            if (!RegExp(opt.reg).test(msg.content.replace(/<@!\d*>/g, "").trim())) continue;

            const allowKeys = opt.channelAllows || ["common"];
            var allowChannel = false;
            for (const allowKey of allowKeys)
                for (const channel of channelAllows[allowKey])
                    if (channel.id == channelId) allowChannel = true;

            if (allowKeys[0] == "all" || allowChannel || msg.author.id == adminId) return {
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