import { IMessage } from "qq-guild-bot";
import { Databaser } from "./databaser";
import log from "./logger";

export class Messager {
    msg: IMessage & {
        guildName?: string,
        channelName?: string,
    };


    constructor(message: IMessage, pusher: Databaser) {
        this.msg = message;

        var messageNotFound = true;
        pusher.saveGuildsTree.forEach(guild => {
            if (guild.id == message.guild_id) {
                guild.channel.forEach(channel => {
                    if (channel.id == message.channel_id) {
                        this.msg.guildName = guild.name;
                        this.msg.channelName = channel.name;
                        log.info(`{${guild.name}}[${channel.name}](${message.author.username}):${message.content}`);
                        messageNotFound = false;
                        return;
                    }
                });
                return;
            }
        });
        if (messageNotFound)
            log.warn(`unKnown message:{${message.guild_id}}[${message.channel_id}](${message.author.username}):${message.content}`);
    }



}