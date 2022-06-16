import { IMessage } from 'qq-guild-bot';
import { init } from './init'
import { randChoice } from './mod/rand';
import { findChannel, findGuilds } from './mod/findChannel';
import log from './mod/logger';

import config from './file/config.json';
import { sendMsg } from './mod/sendMsg';

var userHistory: UserHistory[] = [];
const dayMaxTimes = 59000;
const stopCommand = "stopBot";
const admin = "飞龙project";


async function main() {
    var { client, ws, saveGuildsTree, meId } = await init(config);


    ws.on('PUBLIC_GUILD_MESSAGES', async (data: IntentMessage) => {
        //log.info(mainGuild, typeof mainGuild);

        if (data.eventType == 'AT_MESSAGE_CREATE') {
            //log.info(`<@!${meId}>`);
            try {
                var msg: IMessage = data.msg;

                var messageGuildFoundInGuilds = false;
                saveGuildsTree.forEach(guild => {
                    if (msg.guild_id == guild.id) {
                        log.info(`${guild.name}|||${msg.author.username}|||${msg.content}`), messageGuildFoundInGuilds = true;
                        return;
                    }
                });
                if (!messageGuildFoundInGuilds) log.warn(`unKnown message:${msg.guild_id}|||${msg.author.username}|||${msg.content}`);


                if (msg.content.includes(stopCommand) && msg.author.username == admin) {
                    log.info("stoping");
                    await client.messageApi.postMessage(msg.channel_id, {
                        content: "ok",
                        msg_id: msg.id,
                        message_reference: {
                            message_id: msg.id,
                        },
                    });
                    process.exit();
                }
                //log.debug(msg.channel_id);
                //log.debug(saveGuilds[3].channel);
                var content = msg.content.slice(`<@!${meId}>`.length);
                //log.info(`${content}|`);

                if (findGuilds(saveGuildsTree, msg.guild_id)) {

                    content = content.trim();
                    var userChoice = 0;
                    switch (content) {
                        case "/单抽出奇迹":
                            userChoice = 1;
                        case "/十连大保底":
                            if (userChoice == 0) userChoice = 10;


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
                            break;
                        default:
                            sendMsg(client, msg.channel_id, msg.id, "ん？");
                            //log.info("什么也没发生");
                            break;
                    }
                } else {
                    log.error(`unAuth guild id:${msg.guild_id}|||user:${msg.author.username}`);
                    sendMsg(client, msg.channel_id, msg.id, "未经授权的操作，请联系机器人管理员获取授权");
                }



            } catch (error) {
                log.info(error);
            }

        }

    })
}

main();










