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
                type: 1 | 2;
            };
            guild_id: string;
            target: {
                id: string;
                type: "ReactionTargetType_MSG" | "ReactionTargetType_FEED" | "ReactionTargetType_COMMNENT";
            },
            user_id: string;
        }
    }

    interface RetryResult<R> {
        result?: R;
        errors: any[];
    }

    namespace BiliDynamic {

        export interface List {
            code: number;
            message: string;
            ttl: number;
            data: {
                has_more: boolean;
                items: Item[];
                offset: string;
                update_baseline: string;
                update_num: number;
            };
        }

        export interface Info {
            code: number;
            message: string;
            ttl: number;
            data: {
                item: Item;
            };
        }

        export interface Item {
            basic: {
                comment_id_str: string;
                comment_type: number;
                like_icon: {
                    action_url: string;
                    end_url: string;
                    id: number;
                    start_url: string;
                };
                rid_str: string;
            };
            id_str: string;
            modules: Modules;
            type: Type;
            visible: boolean;
            orig?: Item;
        }

        export const enum Type {
            DYNAMIC_TYPE_NONE = "DYNAMIC_TYPE_NONE",                 // 无效动态
            DYNAMIC_TYPE_FORWARD = "DYNAMIC_TYPE_FORWARD",              // 动态转发	
            DYNAMIC_TYPE_AV = "DYNAMIC_TYPE_AV",                   //投稿视频
            DYNAMIC_TYPE_PGC = "DYNAMIC_TYPE_PGC",                  //剧集（番剧、电影、纪录片）
            DYNAMIC_TYPE_COURSES = "DYNAMIC_TYPE_COURSES",
            DYNAMIC_TYPE_WORD = "DYNAMIC_TYPE_WORD",                 //纯文字动态
            DYNAMIC_TYPE_DRAW = "DYNAMIC_TYPE_DRAW",                 //带图动态
            DYNAMIC_TYPE_ARTICLE = "DYNAMIC_TYPE_ARTICLE",              //投稿专栏
            DYNAMIC_TYPE_MUSIC = "DYNAMIC_TYPE_MUSIC",                //音乐
            DYNAMIC_TYPE_COMMON_SQUARE = "DYNAMIC_TYPE_COMMON_SQUARE",        // 装扮/剧集点评/普通分享
            DYNAMIC_TYPE_COMMON_VERTICAL = "DYNAMIC_TYPE_COMMON_VERTICAL",
            DYNAMIC_TYPE_LIVE = "DYNAMIC_TYPE_LIVE",                //直播间分享
            DYNAMIC_TYPE_MEDIALIST = "DYNAMIC_TYPE_MEDIALIST",           //收藏夹
            DYNAMIC_TYPE_COURSES_SEASON = "DYNAMIC_TYPE_COURSES_SEASON",      //课程
            DYNAMIC_TYPE_COURSES_BATCH = "DYNAMIC_TYPE_COURSES_BATCH",
            DYNAMIC_TYPE_AD = "DYNAMIC_TYPE_AD",
            DYNAMIC_TYPE_APPLET = "DYNAMIC_TYPE_APPLET",
            DYNAMIC_TYPE_SUBSCRIPTION = "DYNAMIC_TYPE_SUBSCRIPTION",
            DYNAMIC_TYPE_LIVE_RCMD = "DYNAMIC_TYPE_LIVE_RCMD",          //直播开播
            DYNAMIC_TYPE_BANNER = "DYNAMIC_TYPE_BANNER",
            DYNAMIC_TYPE_UGC_SEASON = "DYNAMIC_TYPE_UGC_SEASON",         //合集更新
            DYNAMIC_TYPE_SUBSCRIPTION_NEW = "DYNAMIC_TYPE_SUBSCRIPTION_NEW",
        }

        export interface Modules {
            module_author: {
                face: string;
                face_nft: boolean;
                following?: any;
                jump_url: string;
                label: string;
                mid: number;
                name: string;
                official_verify: {
                    desc: string;
                    type: number;
                };
                pendant: {
                    expire: number;
                    image: string;
                    image_enhance: string;
                    image_enhance_frame: string;
                    name: string;
                    pid: number;
                };
                pub_action: string;
                pub_time: string;
                pub_ts: string;
                type: string;
                vip: {
                    avatar_subscript: number;
                    avatar_subscript_url: string;
                    due_date: number;
                    label: {
                        bg_color: string;
                        bg_style: number;
                        border_color: string;
                        img_label_uri_hans: string;
                        img_label_uri_hans_static: string;
                        img_label_uri_hant: string;
                        img_label_uri_hant_static: string;
                        label_theme: string;
                        path: string;
                        text: string;
                        text_color: string;
                        use_img_label: boolean;
                    };
                    nickname_color: string;
                    status: number;
                    theme_type: number;
                    type: number;
                };
            };
            module_dynamic: {
                desc: ModuleDynamicDesc;
                major: ModuleDynamicMajor;
            };
            module_more: {
                three_point_items: {
                    label: string;
                    type: string;
                }[];
            };
            module_stat: {
                comment: {
                    count: number;
                    forbidden: boolean;
                };
                forward: {
                    count: number;
                    forbidden: boolean;
                };
                like: {
                    count: number;
                    forbidden: boolean;
                    status: boolean;
                };
            };
        }

        export interface ModuleDynamicDesc {
            rich_text_nodes: {
                orig_text: string;
                text: string;
                type: string;
            }[];
            text: string;
        }

        export interface ModuleDynamicMajor {
            article?: {
                covers: string[];
                desc: string;
                id: number;
                jump_url: string;
                label: string;
                title: string;
            };
            archive?: {
                aid: number,
                badge: {
                    bg_color: string,
                    color: string,
                    text: string,
                },
                bvid: string,
                cover: string,
                desc: string,
                disable_preview: number,
                duration_text: string,
                jump_url: string,
                stat: {
                    danmaku: string,
                    play: string,
                },
                title: string,
                type: number,
            };
            live?: {
                badge: {
                    bg_color: string;
                    color: string;
                    text: string;
                };
                cover: string;
                desc_first: string;
                desc_second: string;
                id: number;
                jump_url: string;
                live_state: number;
                reserve_type: number;
                title: string;
            };
            live_rcmd?: {
                content: string;//被转义的json
            };
            draw?: {
                id: number;
                items: {
                    height: number;
                    size: number;
                    src: string;
                    tags: any[];
                    width: number;
                }[];
            };
            type: DynamicTypeEnum;
        }

        export interface LiveRcmd {
            type: number;
            live_play_info: {
                live_status: number;
                link: string;
                uid: number;
                cover: string;
                parent_area_id: number;
                parent_area_name: string;
                live_start_time: number;
                room_type: number;
                play_type: number;
                title: string;
                area_name: string;
                live_screen_type: number;
                live_id: string;
                watched_show: {
                    icon: string;
                    icon_location: string;
                    icon_web: string;
                    switch: boolean;
                    num: number;
                    text_small: string;
                    text_large: string;
                };
                room_paid_type: number;
                room_id: number;
                area_id: number;
                pendants: {
                    list: {
                        index_badge: {
                            list: any;
                        };
                        mobile_index_badge: {
                            list: any;
                        };
                    };
                };
                online: number;
            };
            live_record_info?: null;
        }

        export interface DB {
            type: Type;
            msgId: string;
            userId: string;
            userName: string;
            pubTs: bigint;
            content?: ModuleDynamicDesc | null;
            desc?: ModuleDynamicDesc | null;
            major: ModuleDynamicMajor | null;
            origMajor: ModuleDynamicMajor | null;
            origMsgId: string | null;
        }

        export enum MajorTypeEnum {
            MAJOR_TYPE_NONE = "MAJOR_TYPE_NONE",
            MAJOR_TYPE_ARCHIVE = "MAJOR_TYPE_ARCHIVE",
            MAJOR_TYPE_PGC = "MAJOR_TYPE_PGC",
            MAJOR_TYPE_COURSES = "MAJOR_TYPE_COURSES",
            MAJOR_TYPE_DRAW = "MAJOR_TYPE_DRAW",
            MAJOR_TYPE_ARTICLE = "MAJOR_TYPE_ARTICLE",
            MAJOR_TYPE_MUSIC = "MAJOR_TYPE_MUSIC",
            MAJOR_TYPE_COMMON = "MAJOR_TYPE_COMMON",
            MAJOR_TYPE_LIVE = "MAJOR_TYPE_LIVE",
            MAJOR_TYPE_MEDIALIST = "MAJOR_TYPE_MEDIALIST",
            MAJOR_TYPE_APPLET = "MAJOR_TYPE_APPLET",
            MAJOR_TYPE_SUBSCRIPTION = "MAJOR_TYPE_SUBSCRIPTION",
            MAJOR_TYPE_LIVE_RCMD = "MAJOR_TYPE_LIVE_RCMD",
            MAJOR_TYPE_UGC_SEASON = "MAJOR_TYPE_UGC_SEASON",
            MAJOR_TYPE_SUBSCRIPTION_NEW = "MAJOR_TYPE_SUBSCRIPTION_NEW",
        }
    }
}
