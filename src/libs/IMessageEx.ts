import fs from "fs";
import fetch from "node-fetch";
import FormData from 'form-data';
import { GMessageRec, IMember, IMessage, IUser, MessageAttachment, MessageReference } from "qq-bot-sdk";
import { callWithRetry, pushToDB } from "./common";
import config from '../../config/config';


class IMessageChannelCommon implements IntentMessage.MessageChannelCommon {
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
    messageType: MessageType;

    constructor(msg: IntentMessage.MessageChannelCommon, messageType: MessageType) {
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

    async sendMsgExRef(option: Partial<SendOption.Channel>) {
        option.ref = true;
        return this.sendMsgEx(option);
    }

    async sendMsgEx(option: Partial<SendOption.Channel>) {
        global.botStatus.msgSendNum++;
        option.msgId = option.msgId || this.id || await redis.get("lastestMsgId") || undefined;
        option.guildId = option.guildId || this.guild_id;
        option.channelId = option.channelId || this.channel_id;
        option.sendType = option.sendType || this.messageType;
        return callWithRetry(this._sendMsgEx, [option]);
    }

    private _sendMsgEx = async (option: Partial<SendOption.Channel>) => {
        if (option.imagePath || option.imageFile) return this.sendImage(option as any);
        const { ref, content, imageUrl } = option;
        if (option.sendType == MessageType.GUILD) return global.client.messageApi.postMessage(option.channelId || "", {
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

    async sendMarkdown(options: Partial<SendOption.Channel> & SendOption.Markdown) {
        options.eventId = await redis.get(`lastestEventId:${options.guildId || this.guild_id}`) || undefined;
        if (devEnv) log.debug(options.eventId);
        if (options.eventId && allowMarkdown) return callWithRetry(this._sendMarkdown, [options]).catch(err => this.sendMsgEx(options));
        else return this.sendMsgEx(options);
    }

    private _sendMarkdown = async (options: Partial<SendOption.Channel> & SendOption.Markdown) => {
        return fetch(`https://api.sgroup.qq.com/channels/${options.channelId || this.channel_id}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`,
            },
            body: JSON.stringify({
                event_id: options.eventId,
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

    async pushToDB(another: Record<string, string>) {
        const attachments: string[] = [];
        if (this.attachments)
            for (const path of this.attachments) attachments.push(path.url);
        return pushToDB(this.messageType == MessageType.DIRECT ? "directMessage" : "guildMessage", Object.assign({
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
            sendType: MessageType.DIRECT,
            guildId: await redis.hGet(`directUid->Gid:${meId}`, adminId[0]),
        });
    }

    private sendImage = async (option: SendOption.Channel): Promise<IMessage> => {
        const { sendType, content, imagePath, imageFile, imageUrl, msgId, guildId, channelId } = option;
        const pushUrl = (sendType == MessageType.DIRECT) ? `https://api.sgroup.qq.com/dms/${guildId}/messages` : `https://api.sgroup.qq.com/channels/${channelId}/messages`;
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
                "Authorization": `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`,
            }, body: formdata
        }).then(res => res.json()).then(body => {
            if (body.code) throw body;
            return body;
        });
    }
}

export class IMessageGUILD extends IMessageChannelCommon implements IntentMessage.GUILD_MESSAGES__body {
    mentions?: IUser[];
    guildName: string;
    channelName: string;

    constructor(msg: IntentMessage.GUILD_MESSAGES__body, register = true) {
        super(msg, MessageType.GUILD);
        this.mentions = msg.mentions;
        this.guildName = saveGuildsTree[this.guild_id]?.name;
        this.channelName = saveGuildsTree[this.guild_id]?.channels[this.channel_id]?.name;

        if (!register) return;

        log.info(`频公{${this.guildName}}[${this.channelName}|${this.channel_id}](${this.author.username}|${this.author.id})${this._atta}: ${this.content}`);

        const mention: string[] = [];
        if (this.mentions) for (const user of this.mentions) mention.push(user.id);
        this.pushToDB({
            mentions: mention.join(","),
            cName: this.channelName || "",
        });

    }
}

export class IMessageDIRECT extends IMessageChannelCommon implements IntentMessage.DIRECT_MESSAGE__body {
    direct_message: true;
    src_guild_id: string;
    constructor(msg: IntentMessage.DIRECT_MESSAGE__body, register = true) {
        super(msg, MessageType.DIRECT);
        this.direct_message = msg.direct_message;
        this.src_guild_id = msg.src_guild_id;

        if (!register) return;

        log.info(`频私{${this.guild_id}}(${this.author.username}|${this.author.id})${this._atta}: ${this.content}`);
        this.pushToDB({ srcGid: this.src_guild_id });
    }
}

class IMessageChatCommon implements IntentMessage.MessageChatCommon {
    id: string;
    author: { id: string; member_openid: string; };
    content: string;
    timestamp: string;
    messageType: MessageType;
    attachments: { content_type: string; filename: string; height: number; size: number; url: string; width: number; }[];

    constructor(msg: IntentMessage.MessageChatCommon, meaasgeType: MessageType) {
        this.id = msg.id;
        this.author = msg.author;
        this.content = msg.content;
        this.timestamp = msg.timestamp;
        this.messageType = meaasgeType;
        this.attachments = msg.attachments;
    }
}

export class IMessageGROUP extends IMessageChatCommon implements IntentMessage.GROUP_MESSAGE_body {
    group_id: string;
    group_openid: string;
    seq: number;

    constructor(msg: IntentMessage.GROUP_MESSAGE_body, register = true) {
        super(msg, MessageType.GROUP);
        this.group_id = msg.group_id;
        this.group_openid = msg.group_openid;
        this.seq = Number((Math.random() * 10000).toFixed());

        if (!register) return;
        log.info(`群聊[${this.group_id}](${this.author.id}): ${this.content}`);
    }

    async sendMsgExRef(option: Partial<SendOption.Chat>) {
        // option.ref = true;
        return this.sendMsgEx(option);
    }

    async sendMsgEx(option: Partial<SendOption.Chat>) {
        global.botStatus.msgSendNum++;
        option.msgId = option.msgId || this.id || undefined;
        option.groupId = option.groupId || this.group_id;
        option.msgType = option.msgType || (option.ark ? 3 : 0);
        // option.guildId = option.guildId || this.guild_id;
        // option.channelId = option.channelId || this.channel_id;
        // option.sendType = option.sendType || this.messageType;
        const uT = new URL(option.imageUrl || option.fileUrl || "http://0").pathname.split(".").pop() || "";
        const fileMap = [[], ["png", "jpg", "jpeg"], ["mp4"], ["slik"]];
        option.fileType = fileMap.findIndex(v => v.find(i => uT.startsWith(i))) as any || undefined;
        if ((option.fileType as number) == -1) option.fileType = undefined;
        if (option.fileType || option.fileUrl) option.msgType = 7;
        return callWithRetry(this._sendMsgEx, [option]) as any;
    }

    private _sendMsgEx = async (option: Partial<SendOption.Chat>) => {
        // if (option.imagePath || option.imageFile) return this.sendImage(option as any);
        const { content, groupId, msgType, msgId } = option;
        if (!groupId) throw "not has groupId";
        const fileInfo = msgType == 7 ? await this._sendFile(option) : null;
        return client.groupApi.postMessage(groupId, {
            content: content ? ("\n" + content) : "",
            msg_type: msgType || 0,
            msg_id: msgId,
            media: (msgType == 7 && fileInfo) ? {
                file_info: fileInfo,
            } : undefined,
            msg_seq: this.seq++,
        }).then(res => res.data).then(json => {
            if (json.msg != "success") throw json;
            else return json;
        }).catch(async err => {
            await this._sendFile(option, true).catch(err => log.error(err));
            throw err;
        });
    }

    async sendFile(option: Partial<SendOption.Chat>, force: boolean = false) {
        return callWithRetry(this._sendFile, [option, force]);
    }

    private _sendFile = async (option: Partial<SendOption.Chat>, force: boolean = false): Promise<string> => {
        const { imageUrl, fileUrl, groupId, fileType } = option;
        const fUrl = imageUrl || fileUrl;
        if (!groupId) throw "not has groupId";
        if (!fUrl) throw "neither imageUrl nor fileUrl";
        if (!fileType) throw "not has fileType";

        const redisKey = `fileInfo:cache:${fUrl}`;
        const fileInfo = await redis.get(redisKey);
        if (fileInfo && !force) return fileInfo;
        if (fUrl.includes("cdn.arona.schale.top") && !fileInfo) await fetch(fUrl).then(res => res.buffer()).then(buff => { });
        log.info(`资源 ${fUrl} 获取中, 存在: ${!!fileInfo}`);
        const fileRes = await client.groupApi.postFile(groupId, {
            file_type: fileType,
            url: fUrl,
            srv_send_msg: false,
        }).then(res => res.data);
        await redis.setEx(redisKey, 60 * 60 * 24 * 5, fileRes.file_info);
        return fileRes.file_info;
    }

    async sendMarkdown(options: Partial<SendOption.Channel> & SendOption.Markdown): Promise<RetryResult<GMessageRec>> {
        return this.sendMsgEx(options);
    }

    // private _sendMarkdown = async (options: Partial<SendOption.Channel> & SendOption.Markdown) => {
    //     return fetch(`https://api.sgroup.qq.com/channels/${options.channelId || this.channel_id}/messages`, {
    //         method: "POST",
    //         headers: {
    //             "Content-Type": "application/json",
    //             "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`,
    //         },
    //         body: JSON.stringify({
    //             event_id: options.eventId,
    //             markdown: {
    //                 custom_template_id: options.templateId,
    //                 params: Object.entries(options.params).map(([key, value]) => {
    //                     return { key, values: [value] };
    //                 }),
    //             },
    //             keyboard: { id: options.keyboardId },
    //         }),
    //     }).then(async res => {
    //         const json = await res.json();
    //         if (json.code) {
    //             log.error(res.headers.get("x-tps-trace-id"));
    //             throw json;
    //         } else return json;
    //     });
    // }

}

// export class IMessageC2C extends IMessageChatCommon implements IntentMessage.C2C_MESSAGE_body {
//     attachments;

//     constructor(msg: IntentMessage.C2C_MESSAGE_body, register = true) {
//         super(msg, MessageType.FRIEND);
//         this.attachments = msg.attachments;

//         if (!register) return;
//         log.info(`私聊`);
//     }
// }


namespace SendOption {
    export interface Channel {
        ref?: boolean;
        imageFile?: Buffer;
        imagePath?: string;
        imageUrl?: string;
        content?: string;
        sendType: MessageType;
        msgId?: string;
        eventId?: string;
        guildId?: string;
        channelId: string;
        markdown: Markdown;
    }

    export interface Markdown {
        templateId: string;
        params: Record<string, string>;
        keyboardId?: string;
    }

    export interface Ark {
        template_id: number;
        kv: {
            key: string;
            value: string;
        }[];
    }

    export interface Chat {
        // ref?: boolean;
        msgType: 0 | 1 | 2 | 3 | 4 | 7;// 0: 文本 1: 图文混排 2: markdown 3: ark 4: embed 7: media
        imageFile?: Buffer;
        imagePath?: string;
        imageUrl?: string;
        fileUrl?: string;
        fileType?: 1 | 2 | 3; // 1 图片，2 视频，3 语音，4 文件（暂不开放）
        content?: string;
        // sendType: MessageType;
        msgId?: string;
        eventId?: string;
        groupId: string;
        markdown: Markdown;
        ark: Ark;
    }
}

export enum MessageType {
    DIRECT = "DIRECT",
    GUILD = "GUILD",
    GROUP = "GROUP",
    FRIEND = "FRIEND",
}