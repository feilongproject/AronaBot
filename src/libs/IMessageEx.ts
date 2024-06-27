import fs from "fs";
import fetch from "node-fetch";
import FormData from 'form-data';
import { Ark, GMessageRec, IMember, IMessage, IUser, MessageAttachment, MessageKeyboard, MessageReference, MessageMarkdown } from "qq-bot-sdk";
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

    async sendMsgExRef(options: Partial<SendOption.Channel>) {
        options.ref = true;
        return this.sendMsgEx(options);
    }

    async sendMsgEx(options: Partial<SendOption.Channel>) {
        global.botStatus.msgSendNum++;
        options.msgId = options.msgId || this.id || await redis.get(`lastestMsgId:${botType}`) || undefined;
        options.guildId = options.guildId || this.guild_id;
        options.channelId = options.channelId || this.channel_id;
        options.sendType = options.sendType || this.messageType;
        options.ark = options.ark;
        return callWithRetry(this._sendMsgEx, [options]);
    }

    private _sendMsgEx = async (options: Partial<SendOption.Channel>) => {
        if (options.imagePath || options.imageFile) return this.sendImage(options as any);
        const { ref, content, imageUrl, ark } = options;
        if (options.sendType == MessageType.GUILD) return global.client.messageApi.postMessage(options.channelId || "", {
            msg_id: options.msgId,
            content: content,
            message_reference: (ref && options.msgId) ? { message_id: options.msgId, } : undefined,
            image: imageUrl,
            ark: ark,
        }).then(res => res.data);
        else return global.client.directMessageApi.postDirectMessage(options.guildId!, {
            msg_id: options.msgId,
            content: content,
            image: imageUrl,
        }).then(res => ({ ...res.data, traceId: res.headers["x-tps-trace-id"], }));
    }

    async sendMarkdown(options: Partial<SendOption.Channel> & SendOption.MarkdownPublic) {
        options.channelId = options.channelId || this.channel_id;
        options.guildId = options.guildId || this.guild_id || options.channelId ? (Object.entries(saveGuildsTree).find(([_, cList]) => cList.channels[options.channelId!])?.[0]) : undefined;
        options.eventId = await redis.get(`lastestEventId:${meId}:${options.guildId}`) || undefined;
        if (botType == "PlanaBot" || !options.eventId) return this.sendMsgEx(options);
        if (devEnv) log.debug("options.eventId:", options.eventId);

        const markdownConfig = await getMarkdown(options);
        if (!markdownConfig) return this.sendMsgEx(options);
        return callWithRetry(this._sendMarkdown, [{ ...options, ...markdownConfig, }]).catch(err => this.sendMsgEx(options));
    }

    private _sendMarkdown = async (options: Partial<SendOption.Channel> & SendOption.MarkdownOrgin) => {
        return fetch(`https://api.sgroup.qq.com/channels/${options.channelId || this.channel_id}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`,
            },
            body: JSON.stringify({
                event_id: options.eventId,
                markdown: options.markdown,
                keyboard: options.keyboard,
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

    private sendImage = async (options: SendOption.Channel): Promise<IMessage> => {
        const { sendType, content, imagePath, imageFile, imageUrl, msgId, guildId, channelId } = options;
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
    author: { id: string; member_openid?: string; user_openid?: string; };
    content: string;
    timestamp: string;
    messageType: MessageType;
    attachments: IntentMessage.Attachment[];
    _atta: string;
    seq = 1;
    sendToId?: string;

    constructor(msg: IntentMessage.MessageChatCommon & Partial<{ group_id: string; group_openid: string; }>, meaasgeType: MessageType) {
        this.id = msg.id;
        this.author = msg.author;
        this.content = msg.content;
        this.timestamp = msg.timestamp;
        this.messageType = meaasgeType;
        this.attachments = msg.attachments || [];
        this._atta = this.attachments.length ? `[图片${this.attachments.length + "张"}]` : "";
        this.sendToId = this.messageType == MessageType.GROUP ? (msg.group_id || msg.group_openid) : (msg.author.id || msg.author.user_openid);
    }

    async pushToDB(another: Record<string, string>) {
        const attachments: string[] = [];
        if (this.attachments)
            for (const path of this.attachments) attachments.push(path.url);
        return pushToDB(this.messageType == MessageType.GROUP ? "groupMessage" : "c2cMessage", {
            id: this.id,
            aid: this.author.id,
            content: this.content,
            ts: this.timestamp,
            attachments: attachments.join(","),
            ...another,
        });
    }

    async sendMsgExRef(options: Partial<SendOption.Chat>) {
        // option.ref = true;
        return this.sendMsgEx(options);
    }

    async sendMsgEx(options: Partial<SendOption.Chat>) {
        global.botStatus.msgSendNum++;
        options.msgId = options.msgId || this.id || undefined;
        options.sendToId = options.sendToId || this.sendToId;
        options.msgType = options.msgType || (options.ark ? 3 : 0);
        // option.guildId = option.guildId || this.guild_id;
        // option.channelId = option.channelId || this.channel_id;
        // option.sendType = option.sendType || this.messageType;
        const uT = new URL(options.imageUrl || options.fileUrl || "http://0").pathname.split(".").pop() || "";
        const fileMap = [[], ["png", "jpg", "jpeg"], ["mp4"], ["slik"]];
        options.fileType = fileMap.findIndex(v => v.find(i => uT.startsWith(i))) as any || undefined;
        if ((options.fileType as number) == -1) options.fileType = undefined;
        if (options.fileType || options.fileInfo || options.fileUrl || options.imageUrl) options.msgType = 7;
        if ((options.fileUrl || options.imageUrl)?.endsWith("/random")) options.fileType = 1;
        return callWithRetry(this._sendMsgEx, [options]) as any;
    }

    private _sendMsgEx = async (options: Partial<SendOption.Chat>) => {
        const { content, sendToId, msgType, msgId, ark, } = options;
        if (!sendToId) throw "not has sendToId";
        const fileInfo = options.fileInfo || (msgType == 7 ? await this._sendFile(options, (options.fileUrl || options.imageUrl)?.endsWith("/random")) : null);
        // return 
        if (this.messageType == MessageType.GROUP) return client.groupApi.postMessage(sendToId, {
            content: content ? ("\n" + content) : "",
            msg_type: msgType || 0,
            msg_id: msgId,
            media: (msgType == 7 && fileInfo) ? {
                file_info: fileInfo,
            } : undefined,
            msg_seq: this.seq++,
            ark,
        }).then(res => {
            (res.data as any)["x-tps-trace-id"] = res.headers["x-tps-trace-id"];
            return res.data;
        });
        else return client.c2cApi.postMessage(sendToId, {
            content: content ? ("\n" + content) : "",
            msg_type: msgType || 0,
            msg_id: msgId,
            media: (msgType == 7 && fileInfo) ? {
                file_info: fileInfo,
            } : undefined,
            msg_seq: this.seq++,
            ark,
        }).then(res => {
            (res.data as any)["x-tps-trace-id"] = res.headers["x-tps-trace-id"];
            return res.data;
        });
    }

    async sendFile(options: Partial<SendOption.Chat>, force = false) {
        return callWithRetry(this._sendFile, [options, force]);
    }

    private _sendFile = async (options: Partial<SendOption.Chat>, force = false): Promise<string> => {
        const { imageUrl, fileUrl, sendToId, fileType } = options;
        const fUrl = imageUrl || fileUrl;
        if (!sendToId) throw "not has sendToId";
        if (!fUrl) throw "neither imageUrl nor fileUrl";
        if (!fileType) throw "not has fileType";

        const redisKey = `fileInfo:cache:${sendToId}:${fUrl}`.replace(/https?:\/\//, "");
        const fileInfo = await redis.get(redisKey);
        if (fileInfo && !force) return fileInfo;
        // if (fUrl.includes("cdn.arona.schale.top") && !fileInfo) await fetch(fUrl).then(res => res.buffer()).then(buff => { });
        // if (!new URL(fUrl).pathname.startsWith("/p/gacha/")) log.mark(`资源 ${fUrl} 获取中, 存在: ${!!fileInfo}`);
        const fileRes = await (this.messageType == MessageType.GROUP ? client.groupApi.postFile(sendToId, {
            file_type: fileType,
            url: fUrl,
            srv_send_msg: false,
        }).then(res => res.data) : client.c2cApi.postFile(sendToId, {
            file_type: fileType,
            url: fUrl,
            srv_send_msg: false,
        }).then(res => res.data));
        if (!force) await redis.setEx(redisKey, 60 * 60 * 24, fileRes.file_info);
        return fileRes.file_info;
    }

    async sendMarkdown(options: Partial<SendOption.Chat> & Partial<SendOption.MarkdownOrgin> & SendOption.MarkdownPublic): Promise<RetryResult<GMessageRec>> {
        this.seq++;
        options.sendToId = options.sendToId || this.sendToId;
        options.msgId = options.msgId || this.id;

        const markdownConfig = await getMarkdown(options, true);
        if (!markdownConfig || !allowMarkdown) return this.sendMsgEx(options);
        return callWithRetry(this._sendMarkdown, [{ ...options, ...markdownConfig }]).catch(err => this.sendMsgEx(options));
    }

    private _sendMarkdown = async (options: Partial<SendOption.Chat> & SendOption.MarkdownOrgin) => {
        const { sendToId, msgId, markdown, keyboard, eventId, } = options;
        if (!sendToId) throw "sendToId not set";
        // debugger;
        if (this.messageType == MessageType.GROUP) return client.groupApi.postMessage(sendToId, {
            msg_id: msgId,
            msg_type: 2,
            content: " ",
            markdown: markdown,
            keyboard: keyboard,
            msg_seq: this.seq,
            event_id: eventId,
        }).then(res => {
            (res.data as Record<string, any>)["x-tps-trace-id"] = res.headers["x-tps-trace-id"];
            return res.data;
        });
        else return client.c2cApi.postMessage(sendToId, {
            msg_id: msgId,
            msg_type: 2,
            content: " ",
            markdown: markdown,
            keyboard: keyboard,
            msg_seq: this.seq,
            event_id: eventId,
        }).then(res => {
            (res.data as Record<string, any>)["x-tps-trace-id"] = res.headers["x-tps-trace-id"];
            return res.data;
        });
    }
}

export class IMessageGROUP extends IMessageChatCommon implements IntentMessage.GROUP_MESSAGE_body {
    group_id: string;
    group_openid: string;
    author: { id: string; member_openid: string; };

    constructor(msg: IntentMessage.GROUP_MESSAGE_body, register = true) {
        super(msg, MessageType.GROUP);
        this.author = msg.author as any;
        this.group_id = msg.group_id;
        this.group_openid = msg.group_openid;

        if (!register) return;
        log.info(`群聊[${this.group_id}](${this.author.id}): ${this.content}`);
        this.pushToDB({ gid: this.group_id });
    }
}

export class IMessageC2C extends IMessageChatCommon implements IntentMessage.C2C_MESSAGE_body {
    author: { id: string; user_openid: string; };

    constructor(msg: IntentMessage.C2C_MESSAGE_body, register = true) {
        super(msg, MessageType.FRIEND);
        this.author = msg.author as any;
        // this.attachments = msg.attachments;

        if (!register) return;

        log.info(`私聊(${this.author.id})${this._atta}: ${this.content}`);
        this.pushToDB({});
    }
}

async function getMarkdown(options: SendOption.MarkdownPublic, kbCustom = false): Promise<SendOption.MarkdownOrgin | null> {
    const markdownNameId = Object.keys(options).find(v => v.startsWith("params_")) as `params_${string}` | undefined;
    const markdownId = options.templateId || await redis.hGet(`config:md:${markdownNameId?.replace(/^params_/, "")}`, meId);
    if (!markdownId) return null;

    options.params = options.params || options[markdownNameId!];
    if (markdownNameId) options[markdownNameId] = undefined as any;
    if (!options.params.length) options.params = [];
    for (let i = 0; i < mdParamLength; i++) {
        options.params[i] = options.params[i] || "\u200b";
    }
    const kbId = options.keyboardId || options.keyboard?.id || await redis.hGet(`config:kb:${options.keyboardNameId}`, meId);
    const kbContent = (options.keyboardNameId ? (await import("../../data/keyboardMap")).default[options.keyboardNameId] : undefined) || options.keyboard?.content;
    kbCustom = !!kbContent && kbCustom;
    const ret = {
        markdown: {
            custom_template_id: markdownId,
            params: options.params.map((value, i) => ({ key: `v${i + 1}`, values: [value] })),
        },
        keyboard: {
            id: kbCustom ? undefined : kbId,
            content: kbCustom ? kbContent : undefined,
        },
    };
    if (!ret.keyboard.id && !ret.keyboard.content) ret.keyboard = undefined as any;
    return ret;
}

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
        ark?: Ark;
    }

    export interface MarkdownPublic extends MarkdownParams {
        keyboardNameId?: string;
        templateId?: string;
        keyboardId?: string;
        keyboard?: MessageKeyboard;
        params?: string[];
    }
    export type MarkdownParams = Record<`params_${string}`, string[]>;

    export interface MarkdownOrgin {
        markdown: Required<Omit<MessageMarkdown, "content">>;
        keyboard?: MessageKeyboard;
    }

    export interface Chat {
        // ref?: boolean;
        msgType: 0 | 1 | 2 | 3 | 4 | 7;// 0: 文本 1: 图文混排 2: markdown 3: ark 4: embed 7: media
        imageFile?: Buffer;
        fileInfo?: string;
        imagePath?: string;
        imageUrl?: string;
        fileUrl?: string;
        fileType?: 1 | 2 | 3; // 1 图片，2 视频，3 语音，4 文件（暂不开放）
        content?: string;
        // sendType: MessageType;
        msgId?: string;
        eventId?: string;
        ark: Ark;

        sendToId?: string;
    }
}

export enum MessageType {
    DIRECT = "DIRECT",
    GUILD = "GUILD",
    GROUP = "GROUP",
    FRIEND = "FRIEND",
}