import { IMessage } from 'qq-guild-bot';
import { init } from './init'
import { randChoice } from './mod/rand';
import { findChannel } from './mod/findChannel';
import log from './mod/logger';

import config from './file/config.json';
import { sendMsg } from './mod/sendMsg';

var userHistory: UserHistory[] = [];
const allowChannel = ["模拟抽卡"];
const dayMaxTimes = 59000;
const stopCommand = "stopBot";

async function main() {
    var { client, ws, saveGuilds, meId } = await init(config);


    ws.on('PUBLIC_GUILD_MESSAGES', async (data: IntentMessage) => {
        //log.info(mainGuild, typeof mainGuild);

        if (data.eventType == 'AT_MESSAGE_CREATE') {
            var msg: IMessage = data.msg;
            //log.info(`<@!${meId}>`);
            log.info(`${msg.author.username}|||${msg.content}`);

            try {
                if (msg.content.includes(stopCommand)) {
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
                content = content.startsWith(" ") ? content.substring(1) : content;
                content = content.endsWith(" ") ? content.slice(0, -1) : content;


                var userChoice = 0;
                switch (content) {
                    case "/单抽出奇迹":
                        userChoice = 1;
                    case "/十连大保底":
                        if (userChoice == 0) userChoice = 10;


                        if (findChannel(allowChannel, saveGuilds, msg.channel_id)) {

                            var index = userHistory.findIndex((i) => { return i.id == msg.author.id });
                            var nowTime = new Date().getTime();
                            if (index == -1 || userHistory[index].lastTime + dayMaxTimes <= nowTime || msg.author.username == admin) {

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
                                //log.info("time out");
                                await client.messageApi.postMessage(msg.channel_id, {
                                    content: `请求时间过短，还有${(userHistory[index].lastTime + dayMaxTimes - nowTime) / 1000}s冷却完毕`,
                                    msg_id: msg.id,
                                    message_reference: {
                                        message_id: msg.id,
                                    },
                                });
                            }


                        } else {
                            sendMsg(client, msg.channel_id, msg.id, `当前子频道未授权`);
                        }
                        break;
                    default:
                        sendMsg(client, msg.channel_id, msg.id, "ん？");
                        //log.info("什么也没发生");
                        break;
                }



            } catch (error) {
                log.info(error);
            }

        }

    })
}

main();










