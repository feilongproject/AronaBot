import fs from "fs";
import fetch from "node-fetch";
import FormData from 'form-data';
import { IMember, IMessage, IUser, MessageAttachment, MessageReference } from "qq-guild-bot";
import { callWithRetry, pushToDB } from "./common";
import config from '../../config/config.json';


export class IMessageCommon implements IntentMessage.MessageCommon {
    id: string;
    channel_id: string;
    guild_id: string;
    content: string;
    timestamp: string;
    author: IUser;
    member: IMember;
    attachments?: MessageAttachment[];
    seq: number;
    seq_in_channel: string;
    src_guild_id?: string;
    message_reference?: MessageReference;

    _atta: string;
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
        this._atta = this.attachments ? `[图片${this.attachments.length + "张"}]` : "";
    }

    async sendMsgExRef(option: Partial<SendMsgOption>) {
        option.ref = true;
        return this.sendMsgEx(option);
    }

    async sendMsgEx(option: Partial<SendMsgOption>) {
        global.botStatus.msgSendNum++;
        option.msgId = option.msgId || this.id || await redis.get("lastestMsgId") || undefined;
        option.guildId = option.guildId || this.guild_id;
        option.channelId = option.channelId || this.channel_id;
        option.sendType = option.sendType || this.messageType;
        return callWithRetry(this._sendMsgEx, [option]);
    }

    private _sendMsgEx = async (option: Partial<SendMsgOption>) => {
        if (option.imagePath || option.imageFile) return sendImage(option as any);
        const { ref, content, imageUrl } = option;
        if (option.sendType == "GUILD") return global.client.messageApi.postMessage(option.channelId || "", {
            msg_id: option.msgId,
            content: content,
            message_reference: (ref && option.msgId) ? { message_id: option.msgId, } : undefined,
            image: imageUrl,
        }).then(res => res.data);
        else return global.client.directMessageApi.postDirectMessage(option.guildId!, {
            msg_id: option.msgId,
            content: content,
            image: imageUrl,
        }).then(res => res.data);
    }

    async sendMarkdown(option: Partial<SendMsgOption> & SendMsgOption.Markdown) {
        return callWithRetry(this._sendMarkdown, [option]);
    }

    private _sendMarkdown = async (options: Partial<SendMsgOption> & SendMsgOption.Markdown) => {
        const eventId = await redis.get(`lastestEventId:${options.guildId || this.guild_id}`);
        return fetch(`https://api.sgroup.qq.com/channels/${options.channelId || this.channel_id}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`,
            },
            body: JSON.stringify({
                event_id: eventId,
                markdown: {
                    custom_template_id: options.templateId,
                    params: Object.entries(options.params).map(([key, value]) => {
                        return { key, values: [value] };
                    }),
                },
                keyboard: { id: options.keyboardId },
            }),
        }).then(async res => {
            const json = await res.json();
            if (json.code) {
                log.error(res.headers.get("x-tps-trace-id"));
                throw json;
            } else return json;
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

    async sendToAdmin(content: string) {
        return this.sendMsgEx({
            content,
            sendType: "DIRECT",
            guildId: await redis.hGet(`directUid->Gid`, adminId[0]),
        });
    }
}

async function sendImage(option: SendMsgOption): Promise<IMessage> {
    const { sendType, content, imagePath, imageFile, imageUrl, msgId, guildId, channelId } = option;
    const pushUrl = (sendType == "DIRECT") ? `https://api.sgroup.qq.com/dms/${guildId}/messages` : `https://api.sgroup.qq.com/channels/${channelId}/messages`;
    const formdata = new FormData();
    if (msgId) formdata.append("msg_id", msgId);
    if (content) formdata.append("content", content);
    if (imageFile) formdata.append("file_image", imageFile, { filename: 'image.jpg' });
    if (imagePath) formdata.append("file_image", fs.createReadStream(imagePath));
    if (imageUrl) formdata.append("image", imageUrl);
    return fetch(pushUrl, {
        method: "POST",
        headers: {
            "Content-Type": formdata.getHeaders()["content-type"],
            "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`,
        }, body: formdata
    }).then(res => res.json()).then(body => {
        if (body.code) throw body;
        return body;
    });
}

export class IMessageGUILD extends IMessageCommon implements IntentMessage.GUILD_MESSAGES__body {
    mentions?: IUser[];
    guildName: string;
    channelName: string;

    constructor(msg: IntentMessage.GUILD_MESSAGES__body, register = true) {
        super(msg, "GUILD");
        this.mentions = msg.mentions;
        this.guildName = saveGuildsTree[this.guild_id]?.name;
        this.channelName = saveGuildsTree[this.guild_id]?.channels[this.channel_id]?.name;

        if (!register) return;

        log.info(`频道{${this.guildName}}[${this.channelName}|${this.channel_id}](${this.author.username}|${this.author.id})${this._atta}: ${this.content}`);

        const mention: string[] = [];
        if (this.mentions)
            for (const user of this.mentions)
                mention.push(user.id);
        this.pushToDB({
            mentions: mention.join(","),
            cName: this.channelName || "",
        });

    }
}

export class IMessageDIRECT extends IMessageCommon implements IntentMessage.DIRECT_MESSAGE__body {
    direct_message: true;
    src_guild_id: string;
    constructor(msg: IntentMessage.DIRECT_MESSAGE__body, register = true) {
        super(msg, "DIRECT");
        this.direct_message = msg.direct_message;
        this.src_guild_id = msg.src_guild_id;

        if (!register) return;

        log.info(`私信{${this.guild_id}}(${this.author.username}|${this.author.id})${this._atta}: ${this.content}`);
        this.pushToDB({ srcGid: this.src_guild_id });
    }
}

interface SendMsgOption {
    ref?: boolean;
    imageFile?: Buffer;
    imagePath?: string;
    imageUrl?: string;
    content?: string;
    sendType: "DIRECT" | "GUILD";
    msgId?: string;
    eventId?: string;
    guildId?: string;
    channelId: string;
    markdown: SendMsgOption.Markdown;
}

namespace SendMsgOption {
    export interface Markdown {
        templateId: string;
        params: { [key: string]: string };
        keyboardId?: string;
    }
}