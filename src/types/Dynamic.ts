import { MessageType } from "../libs/IMessageEx";

export namespace DynamicPushList {
    export type Root = PushUserInfo[];

    export interface PushUserInfo {
        name: string;
        id: string;
        list: PushInfo[];
    }

    export interface PushInfo {
        id: string;
        name: string;
        type: MessageType;
    }
}


export interface Common<T> {
    code: number;
    message: string;
    ttl: number;
    data: T;
}

export namespace BiliDynamic {

    export type SpaceListRoot = Common<SpaceList>;

    export interface SpaceList {
        has_more: boolean;
        items: Item[];
        offset: string;
        update_baseline: string;
        update_num: number;
    }

    export type InfoRoot = Common<Info>;

    export interface Info {
        item: Item;
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
        type: DynamicTypeEnum;
        visible: boolean;
        orig?: Item;
    }

    export const enum DynamicTypeEnum {
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
        type: MajorTypeEnum;
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
        type: DynamicTypeEnum;
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

    export const enum MajorTypeEnum {
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

export namespace BiliUserCard {
    export type Root = Common<Data>;

    export interface Data {
        card: Card;
        following: boolean;
        archive_count: number;
        article_count: number;
        follower: number;
        like_num: number;
    }

    export interface Card {
        mid: string;
        name: string;
        approve: boolean;
        sex: string;
        rank: string;
        face: string;
        face_nft: number;
        face_nft_type: number;
        DisplayRank: string;
        regtime: number;
        spacesta: number;
        birthday: string;
        place: string;
        description: string;
        article: number;
        attentions: any[];
        fans: number;
        friend: number;
        attention: number;
        sign: string;
        level_info: LevelInfo;
        pendant: Pendant;
        nameplate: Nameplate;
        Official: Official;
        official_verify: OfficialVerify;
        vip: Vip;
        is_senior_member: number;
    }

    export interface LevelInfo {
        current_level: number;
        current_min: number;
        current_exp: number;
        next_exp: number;
    }

    export interface Pendant {
        pid: number;
        name: string;
        image: string;
        expire: number;
        image_enhance: string;
        image_enhance_frame: string;
        n_pid: number;
    }

    export interface Nameplate {
        nid: number;
        name: string;
        image: string;
        image_small: string;
        level: string;
        condition: string;
    }

    export interface Official {
        role: number;
        title: string;
        desc: string;
        type: number;
    }

    export interface OfficialVerify {
        type: number;
        desc: string;
    }

    export interface Vip {
        type: number;
        status: number;
        due_date: number;
        vip_pay_type: number;
        theme_type: number;
        label: Label;
        avatar_subscript: number;
        nickname_color: string;
        role: number;
        avatar_subscript_url: string;
        tv_vip_status: number;
        tv_vip_pay_type: number;
        tv_due_date: number;
        avatar_icon: AvatarIcon;
        vipType: number;
        vipStatus: number;
    }

    export interface Label {
        path: string;
        text: string;
        label_theme: string;
        text_color: string;
        bg_style: number;
        bg_color: string;
        border_color: string;
        use_img_label: boolean;
        img_label_uri_hans: string;
        img_label_uri_hant: string;
        img_label_uri_hans_static: string;
        img_label_uri_hant_static: string;
    }

    export interface AvatarIcon {
        icon_type: number;
        icon_resource: IconResource;
    }

    export interface IconResource { }
}
