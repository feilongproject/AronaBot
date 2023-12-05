import { IMessageGROUP, IMessageGUILD, MessageType } from "../libs/IMessageEx";


const typeMap = { GUILD: "频道", DIRECT: "频道私聊", GROUP: "群聊", FRIEND: "私聊" };

export async function help(msg: IMessageGUILD | IMessageGROUP) {
    const opts: {
        [keyFather: string]: {
            [keyChild: string]: {
                reg: string;
                fnc: string;
                channelAllows?: string[];
                data?: string;
                type: MessageType[],
                describe: string;
                export?: string;
            }
        }
    } = (await import("../../config/opts.json")).command as any;
    const sendStr = [`当前场景下（${typeMap[msg.messageType]}）可用的命令有：`];
    const split = `${" ".repeat(4)}===${" ".repeat(4)}`;

    for (const keyFather in opts) {
        const _: string[] = [];
        for (const keyChild in opts[keyFather]) {
            const opt = opts[keyFather][keyChild];
            if (!opt.export) continue;
            if (!opt.type.includes(msg.messageType)) continue;

            const examples = opt.export.split("\n");
            examples.map(example => _.push(`    > ${example}${split}${opt.describe}`));
        }
        if (_.length) sendStr.push(..._,);
    }

    sendStr.push(
        `参数描述:` +
        `    < > 包括在内的为必填参数`,
        `    [ ] 在内的为选填参数（有 | 存在时，参数只能选择 | 分割后的其中一个参数, 不存在时则为参数表述）`,
        `    所有命令实际使用均不包括 < > 或 [ ]`,
    );
    // sendStr.push(
    //     `常用:`,
    //     `碧蓝档案(7487571598174764531)`,
    //     `🕹ba攻略分享贴(7389666)`,
    //     `BA彩奈测试频道(9919414431536104110)`,
    //     `测试频道1(7519512)`,
    //     "测试帖子频道(14432713)",
    // );

    return msg.sendMsgEx({
        content: sendStr.join("\n"),
    });
}

