import { IMessage } from 'qq-guild-bot';
import { init } from './init'
import { randChoice } from './mod/rand';
import { findChannel } from './mod/findChannel';
import log from './mod/logger';

import config from './file/config.json';

const allowChannel = ["互动小游戏"];
const dayMaxTimes = 200;
const stopCommand = "stopBot";

async function main() {
    var { client, ws, saveGuilds, meId } = await init(config);


    ws.on('PUBLIC_GUILD_MESSAGES', async (data: IntentMessage) => {
        //log.info(mainGuild, typeof mainGuild);

        if (data.eventType == 'AT_MESSAGE_CREATE') {
            var msg: IMessage = data.msg;
            //log.info(`<@!${meId}>`);
            log.info(msg.content);

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

            try {
                dayMaxTimes;

                if (msg.content?.startsWith(`<@!${meId}>`) && (msg.channel_id == findChannel(allowChannel, saveGuilds))) {

                    var content = msg.content.slice(`<@!${meId}>`.length);
                    //log.info(`${content}|`);
                    content = content.startsWith(" ") ? content.substring(1) : content;
                    content = content.endsWith(" ") ? content.slice(0, -1) : content;
                    //log.info(`${content}|`);

                    switch (content) {
                        case "/单抽出奇迹":
                            await client.messageApi.postMessage(msg.channel_id, {
                                content: randChoice(1),
                                msg_id: msg.id,
                                message_reference: {
                                    message_id: msg.id,
                                },
                            });
                            break;
                        case "/十连大保底":
                            //log.info("十连");
                            await client.messageApi.postMessage(msg.channel_id, {
                                content: randChoice(10),
                                msg_id: msg.id,
                                message_reference: {
                                    message_id: msg.id,
                                },
                            });
                            break;
                        default:
                            await client.messageApi.postMessage(msg.channel_id, {
                                content: "ん？",
                                msg_id: msg.id,
                                message_reference: {
                                    message_id: msg.id,
                                },
                            });
                            //log.info("什么也没发生");
                            break;
                    }


                }
            } catch (error) {
                log.info(error);
            }

        }

    })
}

main();










