import fs from "fs";
import fetch from "node-fetch";
import FormData from 'form-data';
import { Ark, GMessageRec, IMember, IMessage, IUser, MessageAttachment, MessageKeyboard, MessageReference, MessageMarkdown } from "qq-bot-sdk";
import { callWithRetry, pushToDB } from "./common";
import config from '../../config/config';


export function findOpts(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C): FindedData | null {
    if (typeof msg.content !== "string") return null;

    const commandFathers = commandConfig.command;
    const channelAllows = commandConfig.channelAllows;

    for (const keyFather in commandFathers)
        for (const keyChild in commandFathers[keyFather]) {
            const opt = commandFathers[keyFather][keyChild];
            // if (devEnv) allowKeys.push("dev");
            if ((typeof opt == "function") || !opt.type.includes(msg.messageType)) continue;
            if (!RegExp(opt.reg).test(msg.content.replace(/<@!\d*>/g, "").trim())) continue;

            if (msg instanceof IMessageGROUP || msg instanceof IMessageC2C) {
                return { path: keyFather, keyChild, ...opt };
            }

            const allowChannels = opt.channelAllows || ["common"];
            const channelAllow: () => boolean = () => {
                for (const allowChannelKey of allowChannels) for (const channel of channelAllows[allowChannelKey])
                    if (channel.id == msg.channel_id) return true;
                return false;
            }
            if (devEnv || msg.guild_id == "5237615478283154023" || msg.messageType == MessageType.DIRECT || allowChannels[0] == "all" || channelAllow()) {
                return { path: keyFather, keyChild, ...opt };
            }
        }

    return null;
}


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
    opts: FindedData | null;

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
        this.opts = null;
    }

    async sendMsgExRef(options: Partial<SendOption.Channel>) {
        options.ref = true;
        return this.sendMsgEx(options);
    }

    async sendMsgEx(_options: string): Promise<RetryResult<any>>
    async sendMsgEx(_options: Partial<SendOption.Base>): Promise<RetryResult<any>>
    async sendMsgEx(_options: Partial<SendOption.Channel>): Promise<RetryResult<any>>
    async sendMsgEx(_options: Partial<SendOption.Channel> | string): Promise<RetryResult<any>> {
        const options = typeof _options === 'string' ? { content: _options } : _options;

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
        this.opts = findOpts(this);

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
        this.opts = findOpts(this);
        this.pushToDB({ srcGid: this.src_guild_id });
    }
}

class IMessageChatCommon implements IntentMessage.MessageChatCommon {
    id: string;
    author: { id: string; member_openid?: string; user_openid?: string; };
    content: string;
    timestamp: string;
    attachments: IntentMessage.Attachment[];
    seq = 1;
    event_id: string;

    _atta: string;
    sendToId?: string;
    messageType: MessageType;
    opts: FindedData | null;

    constructor(msg: IntentMessage.MessageChatCommon & Partial<{ group_id: string; group_openid: string; }>, meaasgeType: MessageType) {
        this.id = msg.id;
        this.author = msg.author;
        this.content = msg.content;
        this.event_id = msg.event_id;
        this.timestamp = msg.timestamp;
        this.messageType = meaasgeType;
        this.attachments = msg.attachments || [];
        this._atta = this.attachments.length ? `[图片${this.attachments.length + "张"}]` : "";
        this.sendToId = this.messageType == MessageType.GROUP ? (msg.group_id || msg.group_openid) : (msg.author.id || msg.author.user_openid);
        this.opts = null;
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

    async sendMsgEx(_options: string): Promise<RetryResult<any>>
    async sendMsgEx(_options: Partial<SendOption.Base>): Promise<RetryResult<any>>
    async sendMsgEx(_options: Partial<SendOption.Chat>): Promise<RetryResult<any>>
    async sendMsgEx(_options: Partial<SendOption.Chat> | string): Promise<RetryResult<any>> {
        const options = typeof _options === 'string' ? { content: _options } : _options;

        global.botStatus.msgSendNum++;
        options.msgId = options.msgId || this.id || undefined;
        options.sendToId = options.sendToId || this.sendToId;
        options.msgType = options.msgType || (options.ark ? 3 : 0);
        options.eventId = options.eventId || this.event_id;
        // option.guildId = option.guildId || this.guild_id;
        // option.channelId = option.channelId || this.channel_id;
        // option.sendType = option.sendType || this.messageType;
        const uT = new URL(options.imageUrl || options.fileUrl || "http://0").pathname.split(".").pop() || "";
        const fileMap = [[], ["png", "jpg", "jpeg"], ["mp4"], ["slik"]];
        options.fileType = fileMap.findIndex(v => v.find(i => uT.startsWith(i))) as any || undefined;
        if ((options.fileType as number) == -1) options.fileType = undefined;
        if (options.fileType || options.fileInfo || options.fileUrl || options.imageUrl) options.msgType = 7;
        if ((options.fileUrl || options.imageUrl)?.endsWith("/random")) options.fileType = 1;
        return callWithRetry(this._sendMsgEx, [options]);
    }

    private _sendMsgEx = async (options: Partial<SendOption.Chat>) => {
        const { content, sendToId, msgType, msgId, ark, eventId } = options;
        if (!sendToId) throw "not has sendToId";
        const fileInfo = options.fileInfo || (msgType == 7 ? await this._sendFile(options, (options.fileUrl || options.imageUrl)?.endsWith("/random")) : null);
        // return 
        if (this.messageType == MessageType.GROUP) return client.groupApi.postMessage(sendToId, {
            content: content ? ("\n" + content) : "",
            msg_type: msgType || 0,
            msg_id: msgId,
            event_id: eventId,
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
            content: content || "",
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
        options.sendToId = options.sendToId || this.sendToId;
        return callWithRetry(this._sendFile, [options, force]);
    }

    private _sendFile = async (options: Partial<SendOption.Chat>, force = false): Promise<string> => {
        const { imageUrl, fileUrl, sendToId, fileType, fileData } = options;
        const fUrl = imageUrl || fileUrl;
        if (!sendToId) throw "not has sendToId";
        if (!fUrl && !fileData) throw "imageUrl/fileUrl/fileData must set one";
        if (!fileType) throw "not has fileType";

        const redisKey = `fileInfo:cache:${sendToId}:${fUrl}`.replace(/https?:\/\//, "");
        const fileInfo = await redis.get(redisKey);
        if (fileInfo && !force) return fileInfo;
        const fileRes = await (this.messageType == MessageType.GROUP ? client.groupApi.postFile(sendToId, {
            file_type: fileType,
            file_data: fileData,
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
        options.eventId = options.eventId || this.event_id;

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
        this.opts = findOpts(this);
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
        this.opts = findOpts(this);
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


interface FindedData {
    path: string;
    fnc: string;
    keyChild: string;
    data?: string;
}

namespace SendOption {

    export interface Base {
        content?: string;
        imagePath?: string;
        imageUrl?: string;
        imageFile?: Buffer;
        msgId?: string;
        eventId?: string;
        ark?: Ark;
    }
    export interface Channel extends Base {
        ref?: boolean;
        sendType: MessageType;
        guildId?: string;
        channelId: string;
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

    export interface Chat extends Base {
        // ref?: boolean;
        msgType: 0 | 1 | 2 | 3 | 4 | 7;// 0: 文本 1: 图文混排 2: markdown 3: ark 4: embed 7: media
        fileInfo?: string;
        fileUrl?: string;
        fileData?: string;
        fileType?: 1 | 2 | 3; // 1 图片，2 视频，3 语音，4 文件（暂不开放）
        sendToId?: string;
    }
}

export enum MessageType {
    DIRECT = "DIRECT",
    GUILD = "GUILD",
    GROUP = "GROUP",
    FRIEND = "FRIEND",
}
