import fetch from "node-fetch";
import { settingConfig } from "../libs/common";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";


export async function onePictureTotalAssault(msg: IMessageGUILD) {
    const server = (await settingConfig(msg.author.id, "GET", ["server"])).server == "jp" ? "jp" : "global";
    const timestamp = await redis.hGet("setting:global", `totalAssaultExpired:${server}`);
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (${server == "jp" ? "日服" : "国际服"}总力战一图流)` +
            `\n攻略制作: 夜猫`,
        imageUrl: `https://arona.feilongproject.com/onePictureTotalAssault/${server}Lastest.png?expired=${timestamp}`,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: `获取出错<@${adminId[0]}>\n${JSON.stringify(err)}` });
    });
}

export async function purgeCache(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;

    return redis.hSet("setting:global", [
        [`totalAssaultExpired:global`, new Date().getTime()],
        [`totalAssaultExpired:jp`, new Date().getTime()],
    ]).then(() => {
        return redis.hGet("setting:global", "upyunToken");
    }).then(upyunToken => {
        return fetch("https://api.upyun.com/purge", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${upyunToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                "urls": `https://arona.feilongproject.com/onePictureTotalAssault/globalLastest.png\nhttps://arona.feilongproject.com/onePictureTotalAssault/jpLastest.png`,
            }),
        });
    }).then(res => {
        return res.json();
    }).then((json: UpyunToken) => {
        const sendStr: string[] = [];
        for (const [index, _result] of json.result.entries())
            sendStr.push(`url ${index} | status: ${_result.status}, code: ${_result.code}, task_id: ${_result.task_id}`);
        return msg.sendMsgEx({ content: sendStr.join("\n"), });
    });
}

interface UpyunToken {
    result: {
        code: number;
        status: string;
        task_id: string;
        url: string;
    }[];
}