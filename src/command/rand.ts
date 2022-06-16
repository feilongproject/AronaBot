import { IMessage, OpenAPI } from "qq-guild-bot";
import { findChannel } from "../mod/findChannel";
import log from "../mod/logger";
import { randChoice } from "../mod/rand";
import { sendMsg } from "../mod/sendMsg";

var userHistory: UserHistory[] = [];
const dayMaxTimes = 59000;
const admin = "飞龙project";



export async function commandRand(client: OpenAPI, saveGuildsTree: SaveGuild[], msg: IMessage, userChoice: number): Promise<void> {

    if (findChannel(saveGuildsTree, msg.channel_id)) {

        var index = userHistory.findIndex((i) => { return i.id == msg.author.id });
        var nowTime = new Date().getTime();
        if ((index == -1) || (userHistory[index].lastTime + dayMaxTimes <= nowTime) || (msg.author.username == admin)) {

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
            log.warn("time out");
            await client.messageApi.postMessage(msg.channel_id, {
                content: `请求时间过短，还有${(userHistory[index].lastTime + dayMaxTimes - nowTime) / 1000}s冷却完毕`,
                msg_id: msg.id,
                message_reference: {
                    message_id: msg.id,
                },
            });
        }


    } else {
        log.error(`unAuth channel id:${msg.channel_id}|||user:${msg.author.username}`);
        sendMsg(client, msg.channel_id, msg.id, `当前子频道未授权`);
    }


}