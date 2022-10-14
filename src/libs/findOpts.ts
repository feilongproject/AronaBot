
export async function findOpts(optStr: string, channelId: string): Promise<{ path: string; fnc: string; data?: string }> {
    const fnc = await import("../../config/opts.json");

    const commandFathers: {
        [keyFather: string]: {
            [keyChild: string]: {
                reg: string;
                fnc: string;
                channelAllows?: string[];
                data?: string;
                describe: string;
            }
        }
    } = fnc.command;

    const channelAllows: {
        [allowKeys: string]: {
            id: string;
            name: string;
        }[];
    } = fnc.channelAllows;

    for (const keyFather in commandFathers) {
        for (const keyChild in commandFathers[keyFather]) {
            const opt = commandFathers[keyFather][keyChild];
            if (RegExp(opt.reg).test(optStr)) {
                const allowKeys = opt.channelAllows || ["common"];
                var returnOk = false;
                for (const allowKey of allowKeys) {
                    for (const allowChannel of channelAllows[allowKey]) {
                        if (allowChannel.id == channelId) returnOk = true;
                    }
                }
                if (allowKeys[0] == "all" || returnOk) return {
                    path: keyFather,
                    fnc: opt.fnc,
                    data: opt.data,
                };
            }

        }
    }


    return {
        path: "err",
        fnc: "err",
    };
}