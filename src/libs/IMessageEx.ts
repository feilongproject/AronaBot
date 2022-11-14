import fs from "fs";
import fetch from 'node-fetch';
import FormData from 'form-data';
import { Ark, Embed, IMember, IMessage, IUser, MessageAttachment } from "qq-guild-bot";
import config from '../../config/config.json';

export class IMessageEx implements IMessage {
    id: string;
    channel_id: string;
    guild_id: string;
    content: string;
    timestamp: string;
    edited_timestamp: string;
    mention_everyone: boolean;
    author: IUser;
    member: IMember;
    attachments: MessageAttachment[];
    embeds: Embed[];
    mentions: IUser[];
    ark: Ark;
    seq?: number;
    seq_in_channel?: string;

    guild_name?: string;
    channel_name?: string;
    messageType: "DIRECT" | "GUILD";

    constructor(msg: IMessage, messageType: "DIRECT" | "GUILD") {
        this.id = msg.id;
        this.channel_id = msg.channel_id;
        this.guild_id = msg.guild_id;
        this.content = msg.content;
        this.timestamp = msg.timestamp;
        this.edited_timestamp = msg.edited_timestamp;
        this.mention_everyone = msg.mention_everyone;
        this.author = msg.author;
        this.member = msg.member;
        this.attachments = msg.attachments;
        this.embeds = msg.embeds;
        this.mentions = msg.mentions;
        this.ark = msg.ark;
        this.seq = msg.seq;
        this.seq_in_channel = msg.seq_in_channel;

        this.messageType = messageType;

        if (messageType == "DIRECT") {
            log.info(`私信{${msg.guild_id}}[${msg.channel_id}](${msg.author.username}|${this.author.id}):${msg.content}`);
            return;
        }

        for (const guild of global.saveGuildsTree) {
            if (guild.id == this.guild_id) {
                for (const channel of guild.channel) {
                    if (channel.id == this.channel_id) {
                        this.guild_name = guild.name;
                        this.channel_name = channel.name;
                        log.info(`频道{${this.guild_name}}[${this.channel_name}](${this.author.username}|${this.author.id}):${this.content}`);
                        return;
                    }
                }
            }
        }
        try {
            log.warn(`unKnown message:{${msg.guild_id}}[${msg.channel_id}](${msg.author.username}):${msg.content}`);
        } catch (error) {
            log.error(msg);
        }

    }

    async sendMsgEx(option: SendMsgOption) {
        global.botStatus.msgSendNum++;
        const { ref, imagePath, content, initiative } = option;
        option.messageType = option.messageType || this.messageType;
        option.msgId = option.msgId || this.id;
        option.guildId = option.guildId || this.guild_id;
        option.channelId = option.channelId || this.channel_id;
        option.sendType = option.sendType || this.messageType;
        if (imagePath) {
            return sendImage(option).catch(err => {
                log.error(err);
            });
        } else {
            if (option.sendType == "GUILD") {
                return global.client.messageApi.postMessage(option.channelId, {
                    content: content,
                    msg_id: initiative ? undefined : this.id,
                    message_reference: ref ? { message_id: this.id, } : undefined
                });
            } else {
                return global.client.directMessageApi.postDirectMessage(option.guildId!, {
                    msg_id: initiative ? undefined : this.id,
                    content: content,
                });
            }
        }
    }

    async sendMsgExRef(option: SendMsgOption) {
        option.ref = true;
        return this.sendMsgEx(option);
    }

    async sendMarkdown(templateId: string, _params?: { [key: string]: string }, keyboardId?: string) {
        const params: { key: string; values: [string]; }[] = [];
        for (const key in _params) params.push({ key, values: [_params[key]] });
        return fetch(`https://api.sgroup.qq.com/channels/${this.channel_id}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`,
            }, body: JSON.stringify({
                markdown: {
                    custom_template_id: templateId,
                    params: params,
                },
                keyboard: {
                    id: keyboardId,
                },
            }),
        }).then(res => {
            return res.json();
        }).catch(err => {
            log.error(err);
        });
    }
}

async function sendImage(option: SendMsgOption) {
    const { messageType, initiative, content, imagePath, msgId, guildId, channelId } = option;
    if (!imagePath) return;
    var pushUrl =
        (messageType == "DIRECT" || option.sendType == "DIRECT") ?
            `https://api.sgroup.qq.com/dms/${guildId}/messages` :
            `https://api.sgroup.qq.com/channels/${channelId}/messages`;
    const formdata = new FormData();
    if (!initiative) formdata.append("msg_id", msgId);
    if (content) formdata.append("content", content);
    formdata.append("file_image", fs.createReadStream(imagePath));
    return fetch(pushUrl, {
        method: "POST",
        headers: {
            "Content-Type": formdata.getHeaders()["content-type"],
            "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`,
        }, body: formdata
    }).then(res => {
        return res.json();
    }).then(body => {
        if (body.code) log.error(body);
        return body;
    }).catch(error => {
        log.error(error);
    });
}

interface SendMsgOption {
    ref?: boolean;
    imagePath?: string;
    content?: string;
    initiative?: boolean;
    messageType?: "DIRECT" | "GUILD";
    sendType?: "DIRECT" | "GUILD";
    msgId?: string;
    guildId?: string;
    channelId?: string;
}