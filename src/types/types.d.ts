import log4js from "log4js";
import { Browser } from "puppeteer";
import COS from "cos-nodejs-sdk-v5";
import { RedisClientType } from "redis";
import { PoolConnection } from "mariadb";
import { IChannel, IMember, IUser, createWebsocket, IOpenAPI, AvailableIntentsEventsEnum } from "qq-bot-sdk";
import { MessageType } from "../libs/IMessageEx";
import { StudentNameAlias, StudentInfo } from "../libs/globalVar";
import config from "../../config/config";

declare global {

    var devEnv: boolean;
    var adminId: string[];
    var log: log4js.Logger;
    var _path: string;
    var client: IOpenAPI;
    var ws: ReturnType<typeof createWebsocket>;
    var meId: string;
    var redis: RedisClientType;
    var mariadb: PoolConnection;
    var browser: Browser;
    var botStatus: {
        startTime: Date;
        msgSendNum: number;
        imageRenderNum: number;
    }
    var hotLoadStatus: number;
    var saveGuildsTree: Record<string, SaveGuild>;
    var studentInfo: StudentInfo;
    var studentNameAlias: StudentNameAlias;
    var botType: BotTypes;
    var allowMarkdown: boolean;
    var cos: COS;
    var mdParamLength: number;

    type BotTypes = keyof typeof config.bots;

    interface Date {
        toDBString: () => string;
    }

    interface Buffer {
        json: <T>() => T;
    }


    var strFormat: (d: any) => string;
    var sleep: (time: number) => Promise<any>;
    var fixName: (name: string) => string;

    var cosUrl: (key: string, fix?: string) => string;
    var cosPutObject: (params: CosPutObjectParams & Partial<COS.ObjectParams>, tag?: string) => Promise<COS.PutObjectResult>;
    var isNumStr: (value: string) => value is `${number}`;
    type CosPutObjectParams = Omit<COS.PutObjectParams, keyof Omit<COS.ObjectParams, "Key">>;

    type InstanceWithReload = { reload: () => void };
    type ClassWithReload = {
        new(...args: any[]): InstanceWithReload;
    };

    // 命令设置
    var commandConfig: CommandConfig.Root;
    namespace CommandConfig {
        export interface Root {
            desc: string;
            command: CommandsList;
            channelAllows: Record<string, { id: string; name: string; }[]>;
        }
        type CommandsList = Record<string, CommandPart>;
        type CommandPart = Record<string, Command>;
        interface Command {
            reg: RegExp;
            fnc: string;
            channelAllows?: string[];
            data?: string;
            type: MessageType[],
            describe: string;
            export?: string;
        }
    }


    // 结巴分词后判断与source的相关性
    interface SearchResultScore extends SearchPinyin {
        score: number;
    }

    interface SearchPinyin {
        id: `${string}`;
        name: string;
        pinyin: string;
    }

    interface StudentData {
        id: number;
        releaseStatus: [boolean, boolean, boolean];
        name: string[];
        descName: string;
        devName: string;
        star: 1 | 2 | 3;
        limitedType: number;
    }

    interface SaveGuild {
        name: string;
        id: string;
        channels: Record<string, SaveChannel>;
    }
    interface SaveChannel {
        name: string;
        id: string;
    }

    interface Member {
        id: string,
        name: string,
    }

    namespace IntentMessage {
        interface EventRespose<T> {
            eventRootType: AvailableIntentsEventsEnum;
            eventType: IntentEventType;
            eventId: string;
            msg: T;
        }

        type INTERACTION = EventRespose<INTERACTION_body>;
        interface INTERACTION_body {
            application_id: string;
            chat_type: number;
            data: {
                resolved: {
                    button_data: string;
                    button_id: string;
                },
                type: number;
            },
            group_member_openid: string;
            group_openid: string;
            id: string;
            scene: string;
            timestamp: string;
            type: number;
            version: number;
        }

        type READY = EventRespose<READY_body>;
        interface READY_body {
            version: number;
            session_id: string;
            user: {
                id: string;
                username: string;
                bot: boolean;
                status: number;
            };
            shard: [number, number];
        }

        type GUILD_MEMBERS = EventRespose<GUILD_MEMBERS__body>;//测试包括 GUILD_MEMBER_ADD,GUILD_UPDATE,GUILD_DELETE
        type GUILD_MEMBERS__body = {
            guild_id: string;
            joined_at: string;
            nick: string;
            op_user_id: string;
            roles: string[];
            user: {
                avatar: string;
                bot: boolean;
                id: string;
                username: string;
            }
        };

        type GUILD = EventRespose<GUILD__body>;//测试包括 GUILD_CREATE,GUILD_UPDATE,GUILD_DELETE
        type GUILD__body = {
            id: string;
            name: string;
            icon: string;
            owner_id: string;
            owner: boolean;
            member_count: number;
            max_members: number;
            description: string;
            joined_at: number;
            channels?: IChannel[];//GUILD_前缀无channels
            unionworld_id: string;
            union_org_id: string;
            op_user_id: string;
            union_appid: string;
        }

        type FORUMS_EVENT = EventRespose<FORUMS_EVENT__body>; // 测试包括 FORUM_REPLY_CREATE,FORUM_POST_CREATE,FORUM_THREAD_CREATE,FORUM_THREAD_UPDATE
        type FORUMS_EVENT__body = {
            author_id: string;
            channel_id: string;
            guild_id: string;
            post_info?: {
                content: string;
                date_time: string;
                post_id: string;
                thread_id: string;
            };
            thread_info?: {
                content: string;
                date_time: string;
                thread_id: string;
                title: string;
            }
        }

        // type CHANNEL = EventRespose<CHANNEL__body>;//测试包括 CHANNEL_CREATE,CHANNEL_UPDATE,CHANNEL_DELETE
        // type CHANNEL__body = {
        //     op_user_id: string;
        //     channels: undefined;//CHANNEL_前缀无channels
        // } & IChannel;

        type GUILD_MESSAGES = EventRespose<GUILD_MESSAGES__body>;
        type GUILD_MESSAGES__body = MessageChannelCommon & {
            mentions?: IUser[];
        }

        type DIRECT_MESSAGE = EventRespose<DIRECT_MESSAGE__body>;
        type DIRECT_MESSAGE__body = MessageChannelCommon & {
            direct_message: true;//不知道这个玩意干啥用
            src_guild_id: string;
        }

        interface MessageChannelCommon {
            attachments?: { url: string; }[];
            author: IUser;//频道中貌似只有avatar,bot,id,username,私信貌似只有avatar,id,username
            channel_id: string;
            content?: string;
            guild_id: string;
            id: string;
            member: IMember;//频道中貌似只有joined_at,nick,roles,私信貌似只有joined_at
            message_reference?: { message_id: string; };
            seq: number;
            seq_in_channel: string;
            timestamp: string;
        }

        type GUILD_MESSAGE_REACTIONS = EventRespose<GUILD_MESSAGE_REACTIONS__body>;
        type GUILD_MESSAGE_REACTIONS__body = {
            channel_id: string;
            emoji: {
                id: string;
                type: 1 | 2;
            };
            guild_id: string;
            target: {
                id: string;
                type: "ReactionTargetType_MSG" | "ReactionTargetType_FEED" | "ReactionTargetType_COMMNENT";
            },
            user_id: string;
        }

        type GROUP_MESSAGE = EventRespose<GROUP_MESSAGE_body>;
        type GROUP_MESSAGE_body = MessageChatCommon & {
            group_id: string;
            group_openid: string;
        }

        type C2C_MESSAGE = EventRespose<C2C_MESSAGE_body>;
        type C2C_MESSAGE_body = MessageChatCommon;

        interface MessageChatCommon {
            id: string;
            attachments?: Attachment[];
            author: {
                id: string;
                member_openid?: string;
                user_openid?: string;
            };
            content: string;
            timestamp: string;
            event_id: string;
        }

        interface GROUP_ROBOT {
            group_openid: string;
            op_member_openid: string;
            timestamp: number;
        }

        interface Attachment {
            content_type: string;
            filename: string;
            size: number;
            url: string;
            height?: number;
            width?: number;
        }
    }

    interface RetryResult<R> {
        result: R;
        errors?: any[];
    }

    const enum IntentEventType {
        READY = 'READY',
        MESSAGE_CREATE = "MESSAGE_CREATE",
        MESSAGE_DELETE = "MESSAGE_DELETE",
        AT_MESSAGE_CREATE = "AT_MESSAGE_CREATE",
        PUBLIC_MESSAGE_DELETE = "PUBLIC_MESSAGE_DELETE",
        DIRECT_MESSAGE_CREATE = "DIRECT_MESSAGE_CREATE",
        DIRECT_MESSAGE_DELETE = "DIRECT_MESSAGE_DELETE",
        GUILD_MEMBER_ADD = "GUILD_MEMBER_ADD",
        GUILD_MEMBER_UPDATE = "GUILD_MEMBER_UPDATE",
        GUILD_MEMBER_REMOVE = "GUILD_MEMBER_REMOVE",
        MESSAGE_REACTION_ADD = "MESSAGE_REACTION_ADD",
        MESSAGE_REACTION_REMOVE = "MESSAGE_REACTION_REMOVE",
        GUILD_CREATE = "GUILD_CREATE",
        GUILD_UPDATE = "GUILD_UPDATE",
        GUILD_DELETE = "GUILD_DELETE",
        CHANNEL_CREATE = "CHANNEL_CREATE",
        CHANNEL_UPDATE = "CHANNEL_UPDATE",
        CHANNEL_DELETE = "CHANNEL_DELETE",

        FORUM_THREAD_CREATE = "FORUM_THREAD_CREATE",     // 当用户创建主题时
        FORUM_THREAD_UPDATE = "FORUM_THREAD_UPDATE",     // 当用户更新主题时
        FORUM_THREAD_DELETE = "FORUM_THREAD_DELETE",     // 当用户删除主题时
        FORUM_POST_CREATE = "FORUM_POST_CREATE",     // 当用户创建帖子时
        FORUM_POST_DELETE = "FORUM_POST_DELETE",      // 当用户删除帖子时
        FORUM_REPLY_CREATE = "FORUM_REPLY_CREATE",    // 当用户回复评论时
        FORUM_REPLY_DELETE = "FORUM_REPLY_DELETE",     // 当用户删除评论时
        FORUM_PUBLISH_AUDIT_RESULT = "FORUM_PUBLISH_AUDIT_RESULT",    // 当用户发表审核通过时

        OPEN_FORUM_THREAD_CREATE = "OPEN_FORUM_THREAD_CREATE",   // 当用户创建主题时
        OPEN_FORUM_THREAD_UPDATE = "OPEN_FORUM_THREAD_UPDATE",    // 当用户更新主题时
        OPEN_FORUM_THREAD_DELETE = "OPEN_FORUM_THREAD_DELETE",   // 当用户删除主题时
        OPEN_FORUM_POST_CREATE = "OPEN_FORUM_POST_CREATE",// 当用户创建帖子时
        OPEN_FORUM_POST_DELETE = "OPEN_FORUM_POST_DELETE", // 当用户删除帖子时
        OPEN_FORUM_REPLY_CREATE = "OPEN_FORUM_REPLY_CREATE",  // 当用户回复评论时
        OPEN_FORUM_REPLY_DELETE = "OPEN_FORUM_REPLY_DELETE",  // 当用户删除评论时

        MESSAGE_AUDIT_PASS = "MESSAGE_AUDIT_PASS",
        MESSAGE_AUDIT_REJECT = "MESSAGE_AUDIT_REJECT",

        GROUP_ADD_ROBOT = "GROUP_ADD_ROBOT",
        GROUP_DEL_ROBOT = "GROUP_DEL_ROBOT",
        GROUP_AT_MESSAGE_CREATE = "GROUP_AT_MESSAGE_CREATE",
        GROUP_MSG_RECEIVE = "GROUP_MSG_RECEIVE",
        GROUP_MSG_REJECT = "GROUP_MSG_REJECT",
        C2C_MESSAGE_CREATE = "C2C_MESSAGE_CREATE",
        C2C_MSG_RECEIVE = "C2C_MSG_RECEIVE",
        C2C_MSG_REJECT = "C2C_MSG_REJECT",
        FRIEND_ADD = "FRIEND_ADD",
        FRIEND_DEL = "FRIEND_DEL",

        INTERACTION_CREATE = "INTERACTION_CREATE",
    }

    interface StudentDataNet {
        Id: number;
        Name: string;
        DevName: string;
        PathName: string;
        StarGrade: 1 | 2 | 3;
        IsLimited: number;
        IsReleased: [boolean, boolean, boolean];
    }

    namespace PostInfo {
        export interface Root {
            paragraphs: Paragraph[];
        }

        export interface Paragraph {
            elems: Elem[];
            // props: Props;
        }

        export interface Elem {
            type: number;
            text?: {
                text: string;
            };
            image?: {
                plat_image: {
                    url: string;
                    image_id: string;
                };
                width_percent: number;
            };
        }

    }
}
