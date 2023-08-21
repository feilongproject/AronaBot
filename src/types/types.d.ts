import log4js from "log4js";
import { Browser } from "puppeteer";
import { PoolConnection } from "mariadb";
import { RedisClientType } from "@redis/client";
import { IChannel, IMember, IUser, createOpenAPI, createWebsocket } from "qq-guild-bot";


declare global {

    var devEnv: boolean;
    var adminId: string[];
    var log: log4js.Logger;
    var _path: string;
    var client: ReturnType<typeof createOpenAPI>;
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
    var showMarkdown: boolean;
    var saveGuildsTree: { [guildId: string]: SaveGuild };
    var studentInfo: StudentInfos;

    interface StudentInfos {
        [id: string]: StudentInfo;
    }

    interface StudentInfo {
        id: number;
        releaseStatus: [boolean, boolean];
        name: string[];
        pathName: string;
        devName: string;
        star: 1 | 2 | 3;
        limitedType: number;
    }

    interface SaveGuild {
        name: string;
        id: string;
        channels: { [channelId: string]: SaveChannel };
    }
    interface SaveChannel {
        name: string;
        id: string;
    }

    interface Member {
        id: string,
        name: string,
    }

    interface Date {
        toDBString: () => string;
    }

    namespace IntentMessage {
        interface EventRespose<T> {
            eventRootType: "GUILD_MESSAGES" | "DIRECT_MESSAGE" | "GUILDS" | "GUILD_MEMBERS" | "FORUMS_EVENT" | "GUILD_MESSAGE_REACTIONS";
            eventType: "MESSAGE_CREATE" | "MESSAGE_DELETE" |
            "AT_MESSAGE_CREATE" | "PUBLIC_MESSAGE_DELETE" |
            "DIRECT_MESSAGE_CREATE" | "DIRECT_MESSAGE_DELETE" |
            "GUILD_MEMBER_ADD" | "GUILD_MEMBER_UPDATE" | "GUILD_MEMBER_REMOVE" |
            "MESSAGE_REACTION_ADD" | "MESSAGE_REACTION_REMOVE";
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
                type: number;
            };
            guild_id: string;
            target: {
                id: string;
                type: number;
            },
            user_id: string;
        }
    }

    interface RetryResult<R> {
        result?: R;
        errors: any[];
    }
}
