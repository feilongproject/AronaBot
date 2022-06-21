import { IMessage, OpenAPI } from "qq-guild-bot";
import { findChannel } from "../mod/findChannel";
import log from "../mod/logger";
import choicesList from "../file/choices.json"
import { sendMsg } from "../mod/sendMsg";

var userHistory: UserHistory[] = [];
const dayMaxTimes = 59000;
const admin = "飞龙project";



export async function commandRand(client: OpenAPI, saveGuildsTree: SaveGuild[], msg: IMessage & IMessageEx, userChoice: number): Promise<void> {

    if (findChannel(saveGuildsTree, msg.channel_id) || msg.guild_name == "QQ频道机器人测试频道") {

        var index = userHistory.findIndex((i) => { return i.id == msg.author.id });
        var nowTime = new Date().getTime();
        if ((index == -1) || (userHistory[index].lastTime + dayMaxTimes <= nowTime) || (msg.author.username.includes(admin))) {

            //log.info(`${content}|`);
            sendMsg(client, msg.channel_id, msg.id, randChoice(userChoice));
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

function randChoice(times: number, msg?: IMessage): string {

    var content = (times == 10) ? `进行了一次十连,活动限定up中\n----------\n` : `进行了一次单抽,抽中了:`;

    //三星角色（彩色卡背）的抽取概率为2.5，二星角色（金色卡背）为18.5，一星角色（灰色卡背）为79

    if (times == 1) {
        var o = once();
        return content += `(${choicesList.starString[o.star]})${o.name}`;
    } else {
        var must = true;
        for (let index = 0; index < times - 1; index++) {
            var o = once();
            if (o.star > 1) must = false;
            content += `(${choicesList.starString[o.star]})${o.name}\n`;
        }
        var o = once();
        if (o.star == 1 && must) {
            content += `*(已强制保底)(${choicesList.starString[2]})${once(2).name}\n`;
        } else {
            content += `(${choicesList.starString[o.star]})${o.name}\n`;
        }

        return content + `----------\n结果仅供娱乐，具体以实际为准\n签到功能目前可用`;
    }

}

function once(mustStar?: 1 | 2 | 3): { name: string, star: number } {
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
function second(star: number): string {
    if (star == 3) {
        var c = Math.round(Math.random() * 1000) % choicesList.star3.length;
        log.info(star + choicesList.star3[c]);
        return choicesList.star3[c];
    } else if (star == 2) {
        var c = Math.round(Math.random() * 1000) % choicesList.star2.length;
        log.info(star + choicesList.star2[c]);
        return choicesList.star2[c];
    } else {
        var c = Math.round(Math.random() * 1000) % choicesList.star1.length;
        log.info(star + choicesList.star1[c]);
        return choicesList.star1[c];
    }

}

