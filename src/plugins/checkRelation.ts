import { IMessageC2C, IMessageGROUP } from '../libs/IMessageEx';

/** 查关系 + QQ 号，返回好友回忆页链接（仅群 / C2C） */
export async function checkRelation(msg: IMessageGROUP | IMessageC2C) {
    const content = msg.content.replaceAll(/<@!?[A-Z0-9]+>/g, '').trim();
    const uin = /^\/?查关系\s*(\d+)$/.exec(content)?.[1];
    if (!uin) {
        return msg.sendMsgEx({ content: '用法: 查关系 <QQ号>' });
    }
    return msg.sendMsgEx({
        content: `http://ti.qq.com/friends/recall?uin=${uin}`,
    });
}
