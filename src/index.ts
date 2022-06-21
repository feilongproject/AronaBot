import { IMessage } from 'qq-guild-bot';
import { init } from './init';
import { findChannel, findGuilds } from './mod/findChannel';
import log from './mod/logger';

import config from './file/config.json';
import { sendMsg } from './mod/sendMsg';
import { commandRand } from './command/rand';
import { ostracism } from './command/ostracism';

const admin = "飞龙project";


async function main() {
    var { client, ws, saveGuildsTree, meId } = await init(config);


    ws.on('PUBLIC_GUILD_MESSAGES', async (data: IntentMessage) => {
        //log.info(mainGuild, typeof mainGuild);
        //log.info(JSON.stringify(data));
        if (data.eventType == 'AT_MESSAGE_CREATE') {
            //log.info(`<@!${meId}>`);
            try {
                var msg: IMessage & IMessageEx = data.msg;

                var messageGuildFoundInGuilds = false;
                saveGuildsTree.forEach(guild => {
                    if (msg.guild_id == guild.id) {
                        msg.guild_name = guild.name;
                        log.info(`${guild.name}|||${msg.author.username}|||${msg.content}`), messageGuildFoundInGuilds = true;
                        return;
                    }
                });
                if (!messageGuildFoundInGuilds) log.error(`unKnown message:${msg.guild_id}|||${msg.author.username}|||${msg.content}`);


                //log.debug(msg.channel_id);
                //log.debug(saveGuilds[3].channel);
                var content = msg.content.slice(`<@!${meId}>`.length);
                //log.info(`${content}|`);

                if (findGuilds(saveGuildsTree, msg.guild_id) || msg.author.username == admin) {
                    var useCommand = false;

                    content = content.trim();
                    if (content.startsWith("陶片放逐")) {
                        msg.content = content;
                        ostracism(client, msg);
                        useCommand = true;
                    }

                    switch (content) {
                        case "stopBot":
                            if (msg.author.username == admin) {
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
                            break;
                        case "/单抽出奇迹":
                            commandRand(client, saveGuildsTree, msg, 1);
                            break;
                        case "/十连大保底":
                            commandRand(client, saveGuildsTree, msg, 10);
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
                    sendMsg(client, msg.channel_id, msg.id, "未经授权的操作，请联系机器人管理员获取授权");
                }



            } catch (error) {
                log.error(error);
            }

        }

    })
}

main();










