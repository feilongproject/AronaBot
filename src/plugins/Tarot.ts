import fs from "fs";
import { IMessageGUILD } from "../libs/IMessageEx";
import config from "../../config/config.json";


export async function todayTarot(msg: IMessageGUILD) {
    const nowDay = (new Date()).setHours(0, 0, 0, 0) / 1000;
    const nextDay = nowDay + 24 * 60 * 60;
    if (!await redis.exists(`Tarot:${nowDay}`)) {
        await redis.hSet(`Tarot:${nowDay}`, "next", nextDay);
        await redis.expireAt(`Tarot:${nowDay}`, nextDay);
    }

    const has = await redis.hGet(`Tarot:${nowDay}`, msg.author.id) || random();
    await redis.hSet(`Tarot:${nowDay}`, msg.author.id, has);
    const [num, type] = has.split(":");
    const desc: Tarot = JSON.parse(fs.readFileSync(`${config.images.Tarot}/Tarot.json`).toString())[Number(num)];

    return msg.sendMsgEx({
        content: `看看『<@${msg.author.id}>』老师今天抽到了什么`
            + `\n${desc.name}(${type == "d" ? "逆位" : "正位"})`
            + `\n${type == "d" ? desc.downDesc : desc.upDesc}`,
        imagePath: `${config.images.Tarot}/${num}_${type}.png`,
    });
}

function random(maxLen = 0) {
    maxLen = maxLen || fs.readdirSync(config.images.Tarot).length - 2;
    const num = Math.round(Math.random() * maxLen);
    const type = (num % 2) == 1 ? "u" : "d";
    return `${Math.floor(num / 2)}:${type}`;
}

interface Tarot {
    name: string;
    upDesc: string;
    downDesc: string;
}