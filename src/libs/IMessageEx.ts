import fs from "fs";
import fetch from 'node-fetch';
import FormData from 'form-data';
import { Ark, Embed, IMember, IMessage, IUser, MessageAttachment, MessageReference, MessageToCreate } from "qq-guild-bot";
import config from '../../config/config.json';
import { pushToDB } from "./common";


export class IMessageCommon implements IntentMessage.MessageCommon {
    id: string;
    channel_id: string;
    guild_id: string;
    content: string;
    timestamp: string;
    author: IUser;
    member: IMember;
    attachments?: MessageAttachment[];
    mentions?: IUser[];
    seq: number;
    seq_in_channel: string;
    src_guild_id?: string;
    message_reference?: MessageReference;
    guild_name?: string;
    channel_name?: string;

    messageType: "DIRECT" | "GUILD";

    constructor(msg: IntentMessage.MessageCommon, messageType: "DIRECT" | "GUILD") {
        this.id = msg.id;
        this.channel_id = msg.channel_id;
        this.guild_id = msg.guild_id;
        this.content = msg.content || "";
        this.timestamp = msg.timestamp;
        this.author = msg.author;
        this.member = msg.member;
        this.attachments = msg.attachments;
        this.seq = msg.seq;
        this.seq_in_channel = msg.seq_in_channel;
        this.message_reference = msg.message_reference;

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
                        log.info(`频道{${this.guild_name}}[${this.channel_name}|${this.channel_id}](${this.author.username}|${this.author.id}):${this.content}`);
                        return;
                    }
                }
            }
        }
        log.warn(`unKnown message:{${msg.guild_id}}[${msg.channel_id}](${msg.author.username}):${msg.content}`);

    }

    async sendMsgEx(option: SendMsgOption) {
        global.botStatus.msgSendNum++;
        const { ref, content, initiative } = option;
        option.msgId = option.msgId || this.id;
        option.guildId = option.guildId || this.guild_id;
        option.channelId = option.channelId || this.channel_id;
        option.sendType = option.sendType || this.messageType;
        if (option.imagePath) {
            return this.sendImage(option);
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
        }).then(json => {
            if (json.code) throw json;
            else return json;
        });
    }

    async sendImage(option: SendMsgOption): Promise<IMessage> {
        const { sendType, initiative, content, imagePath, msgId, guildId, channelId } = option;
        var pushUrl =
            (sendType == "DIRECT" || this.messageType == "DIRECT") ?
                `https://api.sgroup.qq.com/dms/${guildId}/messages` :
                `https://api.sgroup.qq.com/channels/${channelId}/messages`;
        const formdata = new FormData();
        if (!initiative) formdata.append("msg_id", msgId);
        if (content) formdata.append("content", content);
        formdata.append("file_image", fs.createReadStream(imagePath!));
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

    async pushToDB(another: { [key: string]: string }) {
        const attachments: string[] = [];
        if (this.attachments)
            for (const path of this.attachments) attachments.push(path.url);
        return pushToDB(this.messageType == "DIRECT" ? "directMessage" : "guildMessage", Object.assign({
            mid: this.id,
            aid: this.author.id,
            aAvatar: this.author.avatar,
            aName: this.author.username,
            gid: this.guild_id,
            cid: this.channel_id,
            seq: this.seq,
            ts: this.timestamp,
            content: this.content,
            attachments: attachments.join(),
            refer: this.message_reference?.message_id || "",
        }, another));
    }
}

export class IMessageGUILD extends IMessageCommon implements IntentMessage.GUILD_MESSAGE__body {

    constructor(msg: IntentMessage.GUILD_MESSAGE__body) {
        super(msg, "GUILD");
        this.mentions = msg.mentions;

        var mention: string[] = [];
        if (this.mentions)
            for (const user of this.mentions)
                mention.push(user.id);
        this.pushToDB({ mentions: mention.join(",") });
    }
}

export class IMessageDIRECT extends IMessageCommon implements IntentMessage.DIRECT_MESSAGE__body {
    direct_message: true;
    src_guild_id: string;

    constructor(msg: IntentMessage.DIRECT_MESSAGE__body) {
        super(msg, "DIRECT");
        this.direct_message = msg.direct_message;
        this.src_guild_id = msg.src_guild_id;
        this.pushToDB({ srcGid: this.src_guild_id });
    }
}

interface SendMsgOption {
    ref?: boolean;
    imagePath?: string;
    content?: string;
    initiative?: boolean;
    sendType?: "DIRECT" | "GUILD";
    msgId?: string;
    guildId?: string;
    channelId?: string;
}