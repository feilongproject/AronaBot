import { IMessage, OpenAPI } from "qq-guild-bot";
import { findChannel } from "../mod/findChannel";
import log from "../mod/logger";
import choicesList from "../../data/choices.json";
import { sendImage, sendMsg } from "../mod/sendMsg";
import { buildImage } from "../mod/buildImage";

var userHistory: UserHistory[] = [];
const dayMaxTimes = 59000;
const admin = "飞龙project";



export async function commandRand(client: OpenAPI, saveGuildsTree: SaveGuild[], msg: IMessage & IMessageEx, userChoice: number): Promise<void> {

    if (findChannel(saveGuildsTree, msg.channel_id) || msg.guild_name == "QQ频道机器人测试频道") {

        var index = userHistory.findIndex((i) => { return i.id == msg.author.id });
        var nowTime = new Date().getTime();
        if ((index == -1) || (userHistory[index].lastTime + dayMaxTimes <= nowTime) || (msg.author.username.includes(admin))) {

            //log.info(`${content}|`);
            const sendStr = await randChoice(userChoice, msg);
            if (sendStr != null) {
                sendMsg(client, msg.channel_id, msg.id, sendStr);
            }
            //switch
            if (index == -1) {
                userHistory.push({ id: msg.author.id, lastTime: nowTime, });
                log.debug(`push history:${msg.author.id},lastTime:${nowTime}`);
            } else {
                userHistory[index].lastTime = nowTime;
            }
        } else {
            await client.messageApi.postMessage(msg.channel_id, {
                content: `请求时间过短，还有${(userHistory[index].lastTime + dayMaxTimes - nowTime) / 1000}s冷却完毕`,
                msg_id: msg.id,
                message_reference: {
                    message_id: msg.id,
                },
            });
        }


    } else {
        log.warn(`unAuth channel id:${msg.channel_id}|||user:${msg.author.username}`);
        sendMsg(client, msg.channel_id, msg.id, `当前子频道未授权,请在隔壁使用`);
    }


}

/**
 * 对二进制判断，并返回结果（当未知时返回null）
 * 二进制位数介绍：
 * 第0位：1/0（十连/单抽）
 * 第1位：1/0（图片/文本）
 * @param choices 选择条件，以二进制为准
 * @param msg IMessage类型
 * @returns 返回本次抽卡结果
 */
async function randChoice(choices: number, msg: IMessage): Promise<string | null> {
    //三星角色（彩色卡背）的抽取概率为2.5，二星角色（金色卡背）为18.5，一星角色（灰色卡背）为79

    switch (choices) {
        case 0b00://str + 1times
            var o = cTime(1);

            return `————————单抽结果————————\n` +
                `(${choicesList.starString[o[0].star]})(${o[0].name.source})${o[0].name.chineseName}`;

        case 0b01://str + 10times
            var o = cTime(10);

            var content = `————————十连结果————————\n`;

            o.forEach((value, index) => {
                content += `(${choicesList.starString[o[index].star]})(${o[index].name.source})${o[index].name.chineseName}\n`;
            });

            return content +
                `—————————————————————\n` +
                `结果仅供娱乐，具体请以实际欧/非气为准` + `\n图片功能添加中，会时不时抽风`;

        case 0b10://image + 1times

            return null;
        case 0b11://image + 10times
            var imgPath = await buildImage(cTime(10));
            //log.debug(imgPath);
            //imgPath = "/root/RemoteDir/qbot/BAbot/data/pic/bg.png";

            sendImage(msg, imgPath);
            return null;
        default:
            return null;
    }

}

function cTime(times: 1 | 10): { name: Character, star: number }[] {

    var ret: { name: Character, star: number }[] = [];
    if (times == 1) {
        ret.push(once());
    } else if (times == 10) {
        var must = true;
        var _arr = Array.from({ length: 10 }, (v, k) => k);

        _arr.forEach((value, index) => {
            if (index == 9 && must == true) {
                ret.push(once(2));
            } else {
                var o = once();
                if (o.star > 1) must = false;
                ret.push(o);


            }
        });
    }
    return ret;
}

function once(mustStar?: 1 | 2 | 3): { name: Character, star: number } {
    var rNum = Math.round(Math.random() * 1000);
    //log.debug(rNum);
    if (mustStar) return { name: second(mustStar), star: mustStar };
    if (rNum <= 25) {
        return { name: second(3), star: 3 };
    } else if (rNum <= 25 + 185) {
        return { name: second(2), star: 2 };
    } else {
        return { name: second(1), star: 1 };
    }
}

/**
 * 根据星级，返回该星级随机出来的名称
 * @param star 星级
 * @returns 角色名称
 */
function second(star: number): Character {
    if (star == 3) {
        var c = Math.round(Math.random() * 1000) % choicesList.star3.length;
        log.info(`${star}(${choicesList.star3[c].source})${choicesList.star3[c].chineseName}`);
        //log.info(star + choicesList.star3[c]);
        return choicesList.star3[c];
    } else if (star == 2) {
        var c = Math.round(Math.random() * 1000) % choicesList.star2.length;
        log.info(`${star}(${choicesList.star2[c].source})${choicesList.star2[c].chineseName}`);
        return choicesList.star2[c];
    } else {
        var c = Math.round(Math.random() * 1000) % choicesList.star1.length;
        log.info(`${star}(${choicesList.star1[c].source})${choicesList.star1[c].chineseName}`);
        return choicesList.star1[c];
    }

}


interface UserHistory {
    id: string,
    lastTime: number,
}