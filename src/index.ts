import { IMessage } from 'qq-guild-bot';
import { init } from './init';
import { findGuilds } from './mod/findChannel';
import log from './mod/logger';
import { sendMsg } from './mod/sendMsg';
import { commandRand } from './command/rand';
import { ostracism } from './command/ostracism';
import { commandSign } from './command/sign';
import config from '../data/config.json';
import { commandALA } from './command/ALA';

init(config.initConfig).then(initConfig => {
    const { client, ws, saveGuildsTree, meId } = initConfig;
    ws.on('PUBLIC_GUILD_MESSAGES', (data: IntentMessage) => {
        //log.info(mainGuild, typeof mainGuild);
        //log.info(JSON.stringify(data));
        if (data.eventType == 'AT_MESSAGE_CREATE') {
            //log.info(`<@!${meId}>`);
            try {
                var msg: IMessage & IMessageEx = data.msg;

                var messageNotFound = true;
                saveGuildsTree.forEach(guild => {
                    if (guild.id == msg.guild_id) {
                        //log.debug("find guild");
                        guild.channel.forEach(channel => {
                            //log.debug(channel);
                            if (channel.id == msg.channel_id) {
                                msg.guild_name = guild.name;
                                msg.channel_name = channel.name;
                                //log.info(msg.id, msg.channel_id);
                                log.info(`{${guild.name}}[${channel.name}](${msg.author.username}):${msg.content}`), messageNotFound = false;
                                return;
                            }
                        });
                        return;
                    }
                });
                if (messageNotFound)
                    log.warn(`unKnown message:{${msg.guild_id}}[${msg.channel_id}](${msg.author.username}):${msg.content}`)


                //log.debug(msg.channel_id);
                //log.debug(saveGuilds[3].channel);
                var content = msg.content.slice(`<@!${meId}>`.length);
                content = content.trim();
                //log.info(`${content}|`);

                if (findGuilds(saveGuildsTree, msg.guild_id) || msg.author.username == config.admin || msg.guild_name == "QQ频道机器人测试频道") {
                    var useCommand = false;

                    var opts = content.split(" ");

                    if (opts[0] == "陶片放逐" || opts[0] == "/陶片放逐") {
                        msg.content = content;
                        try {
                            ostracism(client, msg);

                        } catch (error) {
                            log.error(error);
                        }

                        useCommand = true;
                    }

                    switch (opts[0]) {
                        case "stopBot":
                            if (msg.author.username == config.admin) {
                                log.info("stoping");
                                client.messageApi.postMessage(msg.channel_id, {
                                    content: "ok",
                                    msg_id: msg.id,
                                    message_reference: {
                                        message_id: msg.id,
                                    },
                                }).then(() => {
                                    process.exit();
                                })

                            }
                            break;
                        case "/单抽出奇迹":
                            commandRand(client, saveGuildsTree, msg, 0b00);
                            break;
                        case "/十连大保底":
                            commandRand(client, saveGuildsTree, msg, 0b01);
                            break;
                        case "单抽奇迹图":
                            commandRand(client, saveGuildsTree, msg, 0b10);
                            break;
                        case "/十连保底图":
                        case "十连保底图":
                            commandRand(client, saveGuildsTree, msg, 0b11);
                            break;
                        case "签到":
                        case "/签到":
                            commandSign(client, msg);
                            break;
                        case "奥利奥":
                        case "/奥利奥":
                            commandALA(client, msg, opts[1]);
                            break;
                        default:
                            if (useCommand == false) {
                                log.warn(`unknown command:${content}`);
                                sendMsg(client, msg.channel_id, msg.id, "ん？");
                                //log.info("什么也没发生");
                                break;
                            }
                    }
                } else {
                    log.error(`unAuth guild:${msg.guild_name}(${msg.guild_id})|||user:${msg.author.username}`);
                    sendMsg(client, msg.channel_id, msg.id, "未经授权或权限树尚未加载完毕，请重试");
                }



            } catch (error) {
                log.error(error);
            }

        }

    })
});









