import log4js from "log4js";
import {
    IGuild,
    IMember,
    IUser,
    IChannel,
    MessageAttachment,
    MessageReference,
    OpenAPI,
    WebsocketClient
} from "qq-guild-bot";
import { PoolConnection } from "mariadb";
//import { Browser } from "puppeteer";
import { RedisClientType } from "@redis/client";


declare global {

    var devEnv: boolean;
    var adminId: string[];
    var log: log4js.Logger;
    var _path: string;
    var client: OpenAPI;
    var ws: WebsocketClient;
    var meId: string;
    var redis: RedisClientType;
    var mariadb: PoolConnection;
    //var browser: Browser | null;
    var botStatus: {
        startTime: Date;
        msgSendNum: number;
        imageRenderNum: number;
    }
    var hotLoadStatus: boolean;
    var saveGuildsTree: { [guildId: string]: SaveGuild };
    var studentInfo: StudentInfo;

    interface StudentInfo {
        [id: string]: {
            releaseStatus: [boolean, boolean];
            name: string[];
            pathName: string;
            devName: string;
            star: 1 | 2 | 3;
            limitedType: number;
        };
    }

    interface SaveGuild {
        name: string;
        id: string;
        channel: { [channelId: string]: SaveChannel };
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
            eventType: "MESSAGE_CREATE" | "MESSAGE_DELETE" |
            "AT_MESSAGE_CREATE" | "PUBLIC_MESSAGE_DELETE" |
            "DIRECT_MESSAGE_CREATE" | "DIRECT_MESSAGE_DELETE" |
            "GUILD_MEMBER_ADD" | "GUILD_MEMBER_UPDATE" | "GUILD_MEMBER_REMOVE";
            eventId: string;
            msg: T;
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
        type GUILD__body = IGuild & {
            op_user_id: string;
            union_appid: string;
            channels: undefined;//GUILD_前缀无channels
        }

        // type CHANNEL = EventRespose<CHANNEL__body>;//测试包括 CHANNEL_CREATE,CHANNEL_UPDATE,CHANNEL_DELETE
        // type CHANNEL__body = {
        //     op_user_id: string;
        //     channels: undefined;//CHANNEL_前缀无channels
        // } & IChannel;

        type GUILD_MESSAGES = EventRespose<GUILD_MESSAGES__body>;
        type GUILD_MESSAGES__body = MessageCommon & {
            mentions?: IUser[];
        }

        type DIRECT_MESSAGE = EventRespose<DIRECT_MESSAGE__body>;
        type DIRECT_MESSAGE__body = MessageCommon & {
            direct_message: true;//不知道这个玩意干啥用
            src_guild_id: string;
        }

        interface MessageCommon {
            attachments?: MessageAttachment[];
            author: IUser;//频道中貌似只有avatar,bot,id,username,私信貌似只有avatar,id,username
            channel_id: string;
            content?: string;
            guild_id: string;
            id: string;
            member: IMember;//频道中貌似只有joined_at,nick,roles,私信貌似只有joined_at
            message_reference?: MessageReference;
            seq: number;
            seq_in_channel: string;
            timestamp: string;
        }
    }

    interface RetryResult<R> {
        result?: R;
        errors: string;
    }
}
