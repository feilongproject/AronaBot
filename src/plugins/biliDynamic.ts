import fetch from "node-fetch";
import * as puppeteer from "puppeteer";
import { readFileSync, writeFileSync } from "fs";
import { IMessageGUILD } from "../libs/IMessageEx";
import { pushToDB, searchDB, sendToAdmin, sleep } from "../libs/common";


const browserCkFile = `${_path}/data/ck.json`;
const dynamicPushFilePath = `${_path}/data/dynamicPush.json`;
const userAgent = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 Edg/116.0.1938.62";

export async function mainCheck() {

    const cookies = await getCookie().catch(err => {
        sendToAdmin(typeof err == "object" ? JSON.stringify(err) : String(err)).catch(() => { });
    });
    if (!cookies) return;

    const dynamicPush: DynamicPush = (await import(dynamicPushFilePath)).default;

    for (const bId in dynamicPush) {
        const bUser = dynamicPush[bId];
        const dynamicItems = await checkUser(bId, cookies).catch(err => {
            log.error(bUser.bName, bId, err);
            return sendToAdmin(`api出错: ${bUser.bName} ${bId} ${JSON.stringify(err)}`.replaceAll(".", "。")).then(() => [] as BiliDynamic.Item[]);
        }).catch(err => { });
        if (!dynamicItems) continue;

        if (devEnv) log.debug(`开始检查 ${bUser.bName}(${bId})的动态`);
        for (const item of dynamicItems) {
            const searchResult: BiliDynamic.DB[] | undefined = await searchDB("biliMessage", "msgId", item.id_str);
            if (searchResult && searchResult[0]?.msgId == item.id_str) continue;
            log.info(`${bUser.bName}(${bId})的动态更新了: ${item.id_str}`);

            const picInfo = await screenshot(item.id_str, item.modules.module_author.pub_ts.toString());
            for (const cId in bUser.channels) {
                const msg = new IMessageGUILD({ id: await redis.get(`lastestMsgId`), } as any, false);
                if (cId == "544252608") {
                    if (item.type == "DYNAMIC_TYPE_FORWARD") continue;
                    await msg.sendMsgEx({
                        channelId: cId,
                        sendType: "GUILD",
                        imageFile: picInfo,
                        content: `https://cdn.arona.schale.top/turn/b/${item.id_str}`,
                    }).catch(err => {
                        log.error(err);
                    });
                } else await msg.sendMsgEx({
                    channelId: cId,
                    sendType: "GUILD",
                    imageFile: picInfo,
                    content: `${devEnv ? "dev " : ""}${bUser.bName} 更新了一条动态\nhttps://cdn.arona.schale.top/turn/b/${item.id_str}`,
                }).catch(err => {
                    log.error(err);
                    return sendToAdmin(`${bUser.bName} ${item.id_str} 发送失败`);
                });
            }

            try {
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
            } catch { }

            await sleep(10 * 1000);
        }
        await sleep(10 * 1000);
    }

    delete require.cache[dynamicPushFilePath];

    await import("./admin").then(m => m.updateGithubVersion());
}

//参考: https://github.com/SocialSisterYi/bilibili-API-collect/issues/686
async function getCookie(): Promise<string> {
    const biliCookie = await redis.get("biliCookie") || "";
    const happy = await checkUser("1", biliCookie).then(items => items.length != 0).catch(err => false);
    // log.debug(`happy ${happy}`);
    if (happy) return biliCookie;

    const newCookie = await fetch("https://space.bilibili.com/1/dynamic", {
        headers: { "User-Agent": userAgent },
    }).then(async res => res.headers.raw()["set-cookie"]).then(rawCookies => {//
        return rawCookies.map(k => k.split(";")[0].trim()).join("; ");
    });
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
            "Content-Length": "6244",
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
    log.debug(`newHappy ${newHappy}`);

    if (newHappy) return newCookie;
    else throw "newCookie not happy";
}

async function checkUser(biliUserId: string, cookies: string): Promise<BiliDynamic.Item[]> {

    //log.debug(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?offset=${offset}&host_mid=${biliUserId}&timezone_offset=${timezoneOffset}`);
    return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${biliUserId}`, {
        headers: {
            "User-Agent": "Mozilla/5.0",// userAgent,
            "Cookie": "SESSDATA=feilongproject.com;", //cookies, //`SESSDATA=feilongproject.com;${cookies}`,
        }
    }).then(res => res.json()).then((json: BiliDynamic.List) => {
        //log.debug(json);
        if (!json.code) return json.data.items;
        throw json;
        //log.info(json.data.items);
    });
}

async function screenshot(biliDynamicId: string, biliDynamicPubTs: string): Promise<Buffer | undefined> {

    if (!global.browser || !browser.isConnected()) global.browser = await puppeteer.launch({
        headless: !devEnv,
        args: ['--no-sandbox'],
    });

    const page = await browser.newPage();
    const cookies: puppeteer.Protocol.Network.Cookie[] = JSON.parse(readFileSync(browserCkFile).toString() || "[]");
    await page.setCookie(...cookies);
    await page.setUserAgent(userAgent);
    await page.setViewport({
        width: 700,
        height: 480,
        deviceScaleFactor: 5,
    });
    await page.goto(`https://t.bilibili.com/${biliDynamicId}`, {
        waitUntil: "networkidle0",
    });
    await page.evaluate(() => {
        document.querySelector("#app > div")?.setAttribute("style", "padding-top:0px;padding-right: 3.2vmin;background-color: #fff;");
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

    });
    const pic = await page.screenshot({
        type: "jpeg",
        quality: 70,
        encoding: "binary",
        fullPage: true,
    });
    writeFileSync(browserCkFile, JSON.stringify(await page.cookies()));
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
