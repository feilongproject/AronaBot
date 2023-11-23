import fs from "fs";
import { IMessageGUILD } from "../libs/IMessageEx";
import config from "../../config/config";


export async function todayTarot(msg: IMessageGUILD) {
    const nowDay = (new Date()).setHours(0, 0, 0, 0) / 1000;
    const nextDay = nowDay + 24 * 60 * 60;
    if (!await redis.exists(`Tarot:${nowDay}`)) {
        await redis.hSet(`Tarot:${nowDay}`, "next", nextDay);
        await redis.expireAt(`Tarot:${nowDay}`, nextDay);
    }

    const has = await redis.hGet(`Tarot:${nowDay}`, msg.author.id);
    const notHas = random();
    await redis.hSet(`Tarot:${nowDay}`, msg.author.id, has || notHas);
    const [num, type] = (has || notHas).split(":");
    const desc: Tarot = JSON.parse(fs.readFileSync(`${config.images.Tarot}/Tarot.json`).toString())[Number(num)];

    if (has) return msg.sendMsgEx({
        content: `『<@${msg.author.id}>』老师今天已经抽过了哦！这是今天的结果：`
            + `\n${desc.name}(${type == "d" ? "逆位" : "正位"})`
            + `\n${type == "d" ? desc.downDesc : desc.upDesc}`
            + `\n\n为防止占用服务器带宽，图片仅在当天第一次时显示`,
    });
    else return msg.sendMsgEx({
        content: `看看『<@${msg.author.id}>』老师今天抽到了什么`
            + `\n${desc.name}(${type == "d" ? "逆位" : "正位"})`
            + `\n${type == "d" ? desc.downDesc : desc.upDesc}`,
        imagePath: `${config.images.Tarot}/${num}_${type}.png`,
    });
}

function random(maxLen = 0) {
    maxLen = maxLen || fs.readdirSync(config.images.Tarot).length - 3;
    const num = Math.round(Math.random() * maxLen);
    const type = (num % 2) == 1 ? "u" : "d";
    return `${Math.floor(num / 2)}:${type}`;
}

interface Tarot {
    name: string;
    upDesc: string;
    downDesc: string;
}