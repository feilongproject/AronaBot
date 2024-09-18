import fs from "fs";
import crypto from "crypto";
import { IMessageC2C, IMessageDIRECT, IMessageGROUP, IMessageGUILD } from "../libs/IMessageEx";
import config from "../../config/config";


export async function todayTarot(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {
    const nowDay = (new Date()).setHours(0, 0, 0, 0) / 1000;
    const nextDay = nowDay + 24 * 60 * 60;
    if (!await redis.exists(`Tarot:${nowDay}`)) {
        await redis.hSet(`Tarot:${nowDay}`, "next", nextDay);
        await redis.expireAt(`Tarot:${nowDay}`, nextDay);
    }

    const has = await redis.hGet(`Tarot:${nowDay}`, msg.author.id);
    const notHas = `${crypto.randomInt(0, 21 + 1)}:${crypto.randomInt(0, 2) == 1 ? "u" : "d"}`;
    const [num, type] = (has || notHas).split(":");
    const desc: Tarot = fs.readFileSync(`${config.images.Tarot}/Tarot.json`).json<Tarot[]>()[Number(num)];
    const atMsg = msg instanceof IMessageGROUP ? "" : `『<@${msg.author.id}>』`;
    return msg.sendMsgEx({
        content: (has ? `${atMsg}老师今天已经抽过了哦！这是今天的结果：` : `看看${atMsg}老师今天抽到了什么`)
            + `\n${desc.name}(${type == "d" ? "逆位" : "正位"})`
            + `\n${type == "d" ? desc.downDesc : desc.upDesc}`,
        imageUrl: cosUrl(`Tarot/${num}_${type}.png`),
    }).then(() => redis.hSet(`Tarot:${nowDay}`, msg.author.id, has || notHas));
}


interface Tarot {
    name: string;
    upDesc: string;
    downDesc: string;
}
