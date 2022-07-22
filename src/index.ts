import { IMessage } from 'qq-guild-bot';
import { init } from './init';
import { findGuilds } from './mod/findChannel';
import log from './mod/logger';
import { commandRand } from './command/rand';
import { ostracism } from './command/ostracism';
import { commandSign } from './command/sign';
import config from '../data/config.json';
import { commandALA } from './command/ALA';
import { commandStatus } from './command/status';
import { Messager } from './mod/messager';



init().then(initConfig => {
    const pusher = initConfig;
    pusher.ws.on('PUBLIC_GUILD_MESSAGES', (data: IntentMessage) => {
        //log.info(mainGuild, typeof mainGuild);
        //log.info(JSON.stringify(data));
        if (data.eventType == 'AT_MESSAGE_CREATE') {
            //log.info(`<@!${meId}>`);
            try {

                var messager = new Messager(data.msg, pusher);


                var content = messager.msg.content.replace(/<@!\d*>/g, "");
                content = content.trim();
                //log.info(`${content}|`);

                if (findGuilds(pusher.saveGuildsTree, messager.msg.guild_id) || messager.msg.author.username == config.admin || messager.msg.guildName == "QQ频道机器人测试频道") {
                    var useCommand = false;

                    var opts = content.split(" ");

                    if (opts[0] == "陶片放逐" || opts[0] == "/陶片放逐") {
                        messager.msg.content = content;
                        try {
                            ostracism(pusher, messager);

                        } catch (error) {
                            log.error(error);
                        }

                        useCommand = true;
                    }

                    switch (opts[0]) {
                        case "stopBot":
                            if (messager.msg.author.username == config.admin) {
                                log.info("stoping");
                                pusher.client.messageApi.postMessage(messager.msg.channel_id, {
                                    content: "ok",
                                    msg_id: messager.msg.id,
                                    message_reference: {
                                        message_id: messager.msg.id,
                                    },
                                }).then(() => {
                                    process.exit();
                                })

                            }
                            break;
                        case "/单抽出奇迹":
                            commandRand(pusher, messager, 0b00);
                            break;
                        case "/十连大保底":
                            commandRand(pusher, messager, 0b01);
                            break;
                        case "单抽奇迹图":
                            commandRand(pusher, messager, 0b10);
                            break;
                        case "/十连保底图":
                        case "十连保底图":
                            commandRand(pusher, messager, 0b11);
                            break;
                        case "签到":
                        case "/签到":
                            commandSign(pusher, messager);
                            break;
                        case "奥利奥":
                        case "/奥利奥":
                            commandALA(pusher, messager, opts[1]);
                            break;
                        case "status":
                        case "/status":
                            commandStatus(pusher, messager);
                            break;
                        default:
                            if (useCommand == false) {
                                log.warn(`unknown command:${content}`);
                                pusher.sendMsg(messager, "ん？输入的指令似乎有什么不太对的地方");
                                //log.info("什么也没发生");
                                break;
                            }
                    }
                } else {
                    log.error(`unAuth guild:${messager.msg.guildName}(${messager.msg.guild_id})|||user:${messager.msg.author.username}`);
                    pusher.sendMsg(messager, "未经授权或权限树尚未加载完毕，请重试");
                }



            } catch (error) {
                log.error(error);
            }

        }

    })
});









