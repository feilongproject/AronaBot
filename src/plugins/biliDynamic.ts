import fetch from "node-fetch";
import * as puppeteer from "puppeteer";
import { sendImage } from "../libs/IMessageEx";
import { pushToDB, searchDB, writeFileSyncEx } from "../libs/common";


const dynamicPushFilePath = `${_path}/data/dynamicPush.json`;

export async function mainCheck() {
    const dynamicPush: DynamicPush = (await import(dynamicPushFilePath)).default;

    for (const bId in dynamicPush) {
        const bUser = dynamicPush[bId];
        const dynamicItems = await checkUser(bId);

        for (const item of dynamicItems) {
            const searchResult: BiliDynamic.DB[] | undefined = await searchDB("biliMessage", "msgId", item.id_str);
            if (searchResult && searchResult[0]?.msgId == item.id_str) continue;
            log.info(`${bUser.bName}(${bId})的动态更新了: ${item.id_str}`);

            await pushToDB("biliMessage", {
                msgId: item.id_str,
                userId: item.modules.module_author.mid,
                userName: item.modules.module_author.name,
                pubTs: item.modules.module_author.pub_ts,
                type: item.type,
                content: item.modules.module_dynamic.desc,
                major: item.modules.module_dynamic.major,
                origMajor: item.orig?.modules.module_dynamic.major,
                origMsgId: item.orig?.id_str,
            });

            const picInfo = await screenshot(item.id_str, item.modules.module_author.pub_ts.toString());
            for (const cId in bUser.channels) {
                await sendImage({
                    channelId: cId,
                    sendType: "GUILD",
                    imageFile: picInfo,
                    content: `${bUser.bName} 更新了一条动态\nhttps://cdn.arona.schale.top/turn/b/${item.id_str}`,
                    msgId: await redis.get("lastestMsgId") || undefined,
                });
            }

        }
    }

    delete require.cache[dynamicPushFilePath];
}

async function checkUser(biliUserId: string, timezoneOffset = 0, offset = ""): Promise<BiliDynamic.Item[]> {

    //log.debug(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?offset=${offset}&host_mid=${biliUserId}&timezone_offset=${timezoneOffset}`);
    return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${biliUserId}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.0.1774.57",
            "Cookie": `DedeUserID=${biliUserId};`,
        }
    }).then(res => res.json()).then((json: BiliDynamic.Root) => {
        //log.debug(json);
        if (!json.code) return json.data.items;
        else throw new Error(JSON.stringify(json));
        //log.info(json.data.items);
    }).catch(err => {
        log.error(err);
        return [];
    });
}

async function screenshot(biliDynamicId: string, biliDynamicPubTs: string): Promise<Buffer | undefined> {

    if (!global.browser) global.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox'],
    });

    const page = await browser.newPage();
    const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 Edg/114.0.1823.51";
    const pic = await page.setUserAgent(ua).then(() => page.setViewport({
        height: 500,
        width: 500,
        deviceScaleFactor: 3,
    })).then(() => page.goto(`https://m.bilibili.com/dynamic/${biliDynamicId}`, {
        waitUntil: "networkidle2",
    })).then(() => page.evaluate(() => {
        const r = "#app > div > div";
        document.querySelector(r)?.remove();//删除nav
        document.querySelector(`${r}.openapp-dialog.large`)?.remove();//删除阴影遮罩
        document.querySelector(`${r}.v-switcher.v-switcher--fluid`)?.remove();//删除"评论"

        document.querySelector(`${r}.launch-app-btn.card-wrap > div > div.dyn-header > div.dyn-header__right`)?.remove();//删除"关注"按钮 (dynamic)
        document.querySelector(`${r}.launch-app-btn.card-wrap > div > div.dyn-content > div.dyn-content__orig.reference > div.dyn-content__orig__additional`)?.remove();//删除"相关游戏" (dynamic)

        document.querySelector(`${r}.launch-app-btn.float-openapp.opus-float-btn`)?.remove();//删除"打开app"按钮
        document.querySelector(`${r}.opus-modules > div.opus-module-content.limit`)?.classList.remove("limit");//"展开阅读全文" (opus)
        document.querySelector(`${r}.opus-modules > div.opus-module-content > div.opus-read-more`)?.remove();//删除"展开阅读全文"阴影 (opus)
        document.querySelector(`${r}.opus-modules > div.opus-module-content > div.link-card-para`)?.remove();//删除"相关游戏" (opus)
        document.querySelector(`${r}.opus-modules > div.opus-module-author > div.launch-app-btn.opus-module-author__action`)?.remove();//删除"关注"按钮 (opus)

    })).then(() => page.$("#app > div > div")).then(value => {
        if (value) return value.screenshot({
            quality: 50,
            type: "jpeg",
        }) as Promise<Buffer>;
    });
    await page.close();
    return pic;
}

interface DynamicPush {
    [bId: string]: {
        bName: string;
        channels: {
            [cId: string]: {
                cName: string;
            }
        }
    }
}

namespace BiliDynamic {

    export interface Root {
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
        archive: {
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
        live: {
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
        live_rcmd: {
            content: string;//被转义的json
        };
        type: string;
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
}