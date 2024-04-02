import fs from "fs";
import crypto from "crypto";
import { IMessageGROUP, IMessageGUILD } from "../libs/IMessageEx";
import config from "../../config/config";


export async function todayTarot(msg: IMessageGUILD | IMessageGROUP) {
    const nowDay = (new Date()).setHours(0, 0, 0, 0) / 1000;
    const nextDay = nowDay + 24 * 60 * 60;
    if (!await redis.exists(`Tarot:${nowDay}`)) {
        await redis.hSet(`Tarot:${nowDay}`, "next", nextDay);
        await redis.expireAt(`Tarot:${nowDay}`, nextDay);
    }

    // if (msg instanceof IMessageGUILD && msg.guild_id == "5237615478283154023") return;
    //    if (msg instanceof IMessageGROUP && msg.group_id != "C677AE4F115CC3FB4ED3AA1CCEF6ABC1")
    //        return msg.sendMsgEx({ content: `该群聊暂未开启该功能, 请联系Bot Master(QQ 1728904631) 开启` });

    const has = await redis.hGet(`Tarot:${nowDay}`, msg.author.id);
    const notHas = `${crypto.randomInt(0, 21 + 1)}:${crypto.randomInt(0, 2) == 1 ? "u" : "d"}`;
    const [num, type] = (has || notHas).split(":");
    const desc: Tarot = JSON.parse(fs.readFileSync(`${config.images.Tarot}/Tarot.json`).toString())[Number(num)];
    const atMsg = `『<@${msg.author.id}>』`;
    return msg.sendMarkdown({
        params_omnipotent: [
            (has) ? `${atMsg}老师今天已经抽过了哦！这是今天的结果：` : `看看${atMsg}老师今天抽到了什么`,
            `\r${desc.name}(${type == "d" ? "逆位" : "正位"})`,
            `\r> ${type == "d" ? desc.downDesc : desc.upDesc}`,
            "\r",
            `![img #230px #408px]`,
            `(${cosUrl(`Tarot/${num}_${type}.png`)})`,
        ],
        content: `看看${atMsg}老师今天抽到了什么`
            + `\n${desc.name}(${type == "d" ? "逆位" : "正位"})`
            + `\n${type == "d" ? desc.downDesc : desc.upDesc}`,
        // imagePath: `${config.images.Tarot}/${num}_${type}.png`,
        imageUrl: cosUrl(`Tarot/${num}_${type}.png`),
    }).then(() => redis.hSet(`Tarot:${nowDay}`, msg.author.id, has || notHas));
}


interface Tarot {
    name: string;
    upDesc: string;
    downDesc: string;
}
