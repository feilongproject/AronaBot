/// <reference lib="dom" />
import fetch from "node-fetch";
import * as puppeteer from "puppeteer";
import { readFileSync, writeFileSync } from "fs";
import { pushToDB, searchDB, sendToAdmin } from "../libs/common";
import { IMessageDIRECT, IMessageGUILD, MessageType } from "../libs/IMessageEx";
import config from "../../config/config";


const browserCkFile = `${_path}/data/ck.json`;
const dynamicPushFilePath = `${_path}/data/dynamicPush.json`;
export const userAgent = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36 Edg/121.0.0.0";

export async function mainCheck(msg?: IMessageGUILD | IMessageDIRECT) {
    // if (!devEnv) return;

    const cookies = await getCookie().catch(err => {
        log.error(err);
        sendToAdmin(typeof err == "object" ? stringifyFormat(err) : String(err)).catch(() => { });
    });
    if (!cookies) return;

    const dynamicPush: DynamicPush[] = (await import(dynamicPushFilePath)).default;

    for (const bUser of dynamicPush) {
        const dynamicItems = await checkUser(bUser.id, cookies).catch(err => {
            log.error(bUser.name, bUser.id, err);
            return sendToAdmin(`api出错: ${bUser.name} ${bUser.id} ${stringifyFormat(err)}`.replaceAll(".", ",")).then(() => [] as BiliDynamic.Item[]);
        }).catch(err => { });
        if (!dynamicItems?.length) break;

        if (devEnv) log.debug(`开始检查 ${bUser.name}(${bUser.id})的动态`);
        for (const item of dynamicItems) {
            const searchResult: BiliDynamic.DB[] | undefined = await searchDB("biliMessage", "msgId", item.id_str);
            if (searchResult && searchResult[0]?.msgId == item.id_str) continue;
            log.info(`${bUser.name}(${bUser.id})的动态更新了: ${item.id_str}`);

            try {
                const imageBuffer = await screenshot(item.id_str, item.modules.module_author.pub_ts.toString(), 60);
                if (!imageBuffer) {
                    log.error(`screenshot(${item.id_str}) not return buff, div not found`);
                    await sendToAdmin(`screenshot(${item.id_str}) not return buff, div not found`);
                    continue;
                }
                const imageKey = `${item.id_str}-${new Date().getTime()}.png`;
                writeFileSync(`${config.imagesOut}/bili-${imageKey}`, imageBuffer);
                if (devEnv) log.debug(`${config.imagesOut}/bili-${imageKey}`);
                await cosPutObject({ Key: `biliDynamic/${imageKey}`, Body: imageBuffer });


                for (const cId in bUser.channels) {
                    const msg = new IMessageGUILD({ id: await redis.get(`lastestMsgId:${botType}`), } as any, false);
                    if (cId == "544252608") {
                        if (item.type == "DYNAMIC_TYPE_FORWARD") continue;
                        await msg.sendMsgEx({
                            channelId: cId,
                            sendType: MessageType.GUILD,
                            imageUrl: cosUrl(`biliDynamic/${imageKey}`),
                            content: `https://t.bilibili.com/${item.id_str}`,
                        });
                        continue;
                    }
                    await msg.sendMsgEx({
                        channelId: cId,
                        sendType: MessageType.GUILD,
                        imageUrl: cosUrl(`biliDynamic/${imageKey}`),
                        content: `${devEnv ? "dev " : ""}${bUser.name} 更新了一条动态\nhttps://t.bilibili.com/${item.id_str}`,
                    });
                }

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
            } catch (err) {
                log.error(err);
                await import("../eventRec").then(m => m.mailerError(item, err instanceof Error ? err : new Error(stringifyFormat(err))).catch(err => { }));
                await sendToAdmin(`${bUser.name} ${item.id_str} 发送失败\n${stringifyFormat(err).replaceAll(".", ",")}`).catch(err => { });
            }

            await sleep(5 * 1000);
        }
        await sleep(5 * 1000);
    }

    delete require.cache[dynamicPushFilePath];
}

//参考: https://github.com/SocialSisterYi/bilibili-API-collect/issues/686
export async function getCookie(): Promise<string> {
    const biliCookie = await redis.get("biliCookie") || "";
    const happy = await checkUser("1", biliCookie).then(items => items.length != 0).catch(err => false);
    // log.debug(`happy ${happy}`);
    if (happy) return biliCookie;

    const newCookie = await fetch("https://space.bilibili.com/1/dynamic", {
        headers: { "User-Agent": userAgent },
    }).then(res => res.headers.raw()["set-cookie"]).then(rawCookies => rawCookies.map(k => k.split(";")[0].trim()).join("; "));
    if (!newCookie) throw "not get Cookie in headers";

    const payload = readFileSync(`${_path}/data/biliPayload.txt`).toString();
    const checkJson = await fetch("https://api.bilibili.com/x/internal/gaia-gateway/ExClimbWuzhi", {
        headers: {
            "Cookie": newCookie,
            "User-Agent": userAgent,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Cache-Control": "no-cache",
            // "Content-Length": "6244",
            "Content-Type": "application/json;charset=UTF-8",
            "Dnt": "1",
            "Origin": "https://space.bilibili.com",
            "Pragma": "no-cache",
            "Referer": "https://space.bilibili.com/1/dynamic",
            "Sec-Ch-Ua": `"Not.A/Brand";v="8", "Chromium";v="114", "Microsoft Edge";v="114"`,
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "Windows",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
        },
        method: "POST",
        body: payload,
    }).then(res => res.json());
    if (checkJson.code == 0 || checkJson.message == "0")
        await redis.set("biliCookie", newCookie).then(() => sendToAdmin("new cookie got it"));

    const newHappy = await checkUser("1", newCookie).then(items => items.length != 0).catch(err => false);
    if (devEnv) log.debug(`newHappy ${newHappy}`);

    if (newHappy) return newCookie;
    else throw "newCookie not happy";
}

async function checkUser(biliUserId: string, cookies: string): Promise<BiliDynamic.Item[]> {

    //log.debug(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?offset=${offset}&host_mid=${biliUserId}&timezone_offset=${timezoneOffset}`);
    return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${biliUserId}`, {
        headers: {
            "User-Agent": userAgent,// userAgent,
            "Cookie": cookies, //`SESSDATA=feilongproject.com;${cookies}`,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Cache-Control": "no-cache",
            // "Content-Length": "6244",
            "Content-Type": "application/json;charset=UTF-8",
            "Dnt": "1",
            "Origin": "https://space.bilibili.com",
            "Pragma": "no-cache",
            "Referer": "https://space.bilibili.com/1/dynamic",
            "Sec-Ch-Ua": `"Not.A/Brand";v="8", "Chromium";v="114", "Microsoft Edge";v="114"`,
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "Windows",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
        }
    }).then(res => res.json()).then((json: BiliDynamic.List) => {
        //log.debug(json);
        if (!json.code) return json.data.items;
        throw json;
        //log.info(json.data.items);
    });
}

async function screenshot(biliDynamicId: string, pubTs: string, quality = 60): Promise<Buffer | undefined> {

    if (!global.browser || !browser.connected) global.browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox'],
    });

    const page = await browser.newPage();
    const cookies: puppeteer.Protocol.Network.Cookie[] = JSON.parse(readFileSync(browserCkFile).toString() || "[]");
    await page.setCookie(...cookies);
    await page.setUserAgent(userAgent);
    await page.setViewport({
        width: 700,
        height: 1500,
        deviceScaleFactor: 5,
    });
    await page.goto(`https://t.bilibili.com/${biliDynamicId}`, {
        waitUntil: "networkidle0",
    });
    if (await page.$("#app > div > div > div.launch-app-btn.opus-module-blocked"))
        await page.reload({ waitUntil: "networkidle0" });

    await page.evaluate(() => {
        const r = "#app > div > div";
        document.querySelector(r)?.remove();//删除nav
        document.querySelector(`${r}.openapp-dialog.large`)?.remove();//删除阴影遮罩
        document.querySelector(`${r}.v-switcher.v-switcher--fluid`)?.remove();//删除"评论"

        document.querySelector(`${r}.launch-app-btn.card-wrap > div > div.dyn-share`)?.remove()//删除分享至 (dynamic)
        document.querySelector(`${r}.launch-app-btn.card-wrap > div > div.dyn-header > div.dyn-header__right`)?.remove();//删除"关注"按钮 (dynamic)
        document.querySelector(`${r}.launch-app-btn.card-wrap > div > div.dyn-content > div.dyn-content__orig.reference > div.dyn-content__orig__additional`)?.remove();//删除"相关游戏" (dynamic)

        document.querySelector(`${r}.launch-app-btn.float-openapp.opus-float-btn`)?.remove();//删除"打开app"按钮
        document.querySelector(`${r}.opus-modules > div.opus-module-content.limit`)?.classList.remove("limit");//"展开阅读全文" (opus)
        document.querySelector(`${r}.opus-modules > div.opus-module-content > div.opus-read-more`)?.remove();//删除"展开阅读全文"阴影 (opus)
        document.querySelector(`${r}.opus-modules > div.opus-module-content > div.link-card-para`)?.remove();//删除"相关游戏" (opus)
        document.querySelector(`${r}.opus-modules > div.opus-module-author > div.launch-app-btn.opus-module-author__action`)?.remove();//删除"关注"按钮 (opus)

        // document.querySelector("#app > div")?.setAttribute("style", "padding-top:0px;padding-right: 3.2vmin;background-color: #fff;");
        // document.querySelector(`#bili-header-container`)?.remove();
        // document.querySelector(`#app > div.content > div > div > div.bili-dyn-item__panel > div.bili-comment-container.bili-dyn-comment`)?.remove();
    });
    // const pic = await page.$("#app").then(value => value!.screenshot({
    //     type: "jpeg",
    //     quality: 70,
    //     encoding: "binary",
    // }) as Promise<Buffer>);
    const pic = await (await page.$("#app > div > div"))?.screenshot({
        type: "png",
        encoding: "binary",
    }) as Buffer | null;

    writeFileSync(browserCkFile, stringifyFormat(await page.cookies()));
    await page.close();
    return pic || undefined;
}

interface DynamicPush {
    name: string;
    id: string;
    channels: Record<string, string>;
}
