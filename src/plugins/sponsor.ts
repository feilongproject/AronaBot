import { IMessageGUILD } from "../libs/IMessageEx";
import config from '../../config/config.json';

export async function sponsor(msg: IMessageGUILD) {
    return msg.sendMsgEx({
        content: `<@!${msg.author.id}>` +
            `\nBA彩奈目前是用爱发电的负收入状态，但运行需要服务器支持，同时出问题时需要开发者抽出时间解决，希望可以通过爱发电平台请作者喝杯茶` +
            `\n(赞助会解锁更少的限制，也可以为开发者女装计划助力！)`,
        imagePath: config.images.sponsor,
    })
}