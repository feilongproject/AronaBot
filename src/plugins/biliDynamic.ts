/// <reference lib="dom" />
import fetch from "node-fetch";
import imageSize from "image-size";
import * as puppeteer from "puppeteer";
import { readFileSync, writeFileSync } from "fs";
import { BiliDynamic, DynamicPushList, BiliUserCard } from "../types/Dynamic";
import { sendToAdmin, sendToGroup } from "../libs/common";
import { IMessageC2C, IMessageDIRECT, IMessageGROUP, IMessageGUILD, MessageType } from "../libs/IMessageEx";
import config from "../../config/config";


const browserCkFile = `${_path}/data/ck.json`;
const dynamicPushFilePath = `${_path}/data/dynamicPush.ts`;
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0";
const userAgentAndroid = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 Edg/126.0.0.0";


export async function mainCheck(msg?: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {
    if (await redis.get("devEnv") && !devEnv) return;

    await msg?.sendMsgEx({ content: `${devEnv},checking` });

    const cookies = await getCookie().catch(err => {
        log.error(err);
        const _err = typeof err == "object" ? strFormat(err) : String(err);
        return (msg ? msg.sendMsgEx({ content: _err }) : sendToAdmin(_err)).catch(() => { }) as any;
    });
    if (typeof cookies != "string") return await msg?.sendMsgEx({ content: `cookies 未找到` });

    const dynamicPushList: DynamicPushList.Root = (await import(dynamicPushFilePath)).pushList; // 推送列表

    for (const bUser of dynamicPushList) {
        const { id: userId } = bUser;
        if (!bUser.list.length) { await sleep(5 * 1000); continue; }

        if (await redis.exists(`dynamicPushing:${userId}`) && !devEnv) continue; // 检测到锁时忽略当前用户
        await redis.setEx(`dynamicPushing:${userId}`, 60 * 3, "1"); // 开始推送，设置3分钟的用户锁

        const dynamicItems = await getUserDynamics(userId, cookies).catch(err => {
            if (devEnv) log.error(bUser, userId, err);
            const _err = `api出错: ${bUser.name} ${userId} ${strFormat(err)}`.replaceAll(".", ",");
            return (msg ? msg.sendMsgEx({ content: _err }) : sendToAdmin(_err)).then(() => { });
        }).catch(err => { });
        if (!dynamicItems) break;

        if (devEnv) await msg?.sendMsgEx({ content: `开始检查 ${bUser.name}(${userId})的动态` });
        log.info(`开始检查 ${bUser.name}(${userId})的动态`);
        for (const item of dynamicItems) { // 检查每个动态
            const { id_str: dynamicId } = item;
            const isAllPushed = await redis.hExists(`biliMessage:allPushed:${userId}`, dynamicId); // 检查该动态是否全部推送完毕
            // if (isAllPushed) { await sleep(10 * 1000); continue; }
            if (isAllPushed) continue;

            const idPushed = await redis.hmGet(`biliMessage:idPushed:${dynamicId}`, bUser.list.map(v => v.id));
            const notPushedList = bUser.list.filter((_, i) => !idPushed[i]).filter(v => v.enable);
            if (!notPushedList.length) {
                if (devEnv) log.debug(`biliMessage:allPushed ${userId}-${dynamicId}`);
                await redis.hSet(`biliMessage:allPushed:${userId}`, dynamicId, "pushed: " + bUser.list.map(v => v.id).join());
                await redis.del(`biliMessage:idPushed:${dynamicId}`);
                continue;
            } // 已经全部推送完毕, 进行标记并结束, 删除推送记录

            if (devEnv) log.debug(`pushing ${userId}-${dynamicId}`);
            const imageKey = `${userId}-${dynamicId}-${new Date().getTime()}.png`;
            try {
                await msg?.sendMsgEx({ content: `开始截图 ${dynamicId}` });
                const imageBuffer = await screenshot(dynamicId, item.modules.module_author.pub_ts.toString(), 30);
                if (!imageBuffer || !imageBuffer.length) {
                    log.error(`screenshot(${dynamicId}) not return buff, div not found`);
                    await sendToAdmin(`screenshot(${dynamicId}) not return buff, div not found`);
                    return;
                }
                writeFileSync(`${config.imagesOut}/bili-${imageKey}`, imageBuffer);
                await cosPutObject({ Key: `biliDynamic/${imageKey}`, Body: imageBuffer, });
                if (devEnv) log.debug(`${config.imagesOut}/bili-${imageKey}`);

                for (const pushInfo of notPushedList) { // 检查未推送的
                    await dynamicPush(dynamicId, pushInfo, item, imageKey, imageBuffer);
                    await sleep(5 * 1000);
                }

            } catch (err) {
                await import("../eventRec")
                    .then(m => m.mailerError({ bUser, dynamicId, imageKey, notPushedList, idPushed, item, }, err instanceof Error ? err : new Error(strFormat(err))))
                    .catch(err => log.error(err));
                await sleep(10 * 1000); continue;
            }
            await sleep(5 * 1000);
        }

        await redis.del(`dynamicPushing:${userId}`); // 检查完毕，删除锁
        await sleep(10 * 1000);
    }

    delete require.cache[dynamicPushFilePath];

}

async function dynamicPush(dynamicId: string, pushInfo: DynamicPushList.PushInfo, item: BiliDynamic.Item, imageKey: string, imageBuffer: Buffer) {
    if (pushInfo.type == MessageType.GROUP) {
        let retryTimes = 3;
        while (retryTimes--) {
            // debugger;

            if (!devEnv && await redis.hExists(`biliMessage:idPushed:${dynamicId}`, pushInfo.id)) return;
            await sendToGroup(`dynamicPush`, `${pushInfo.id},${imageKey}`, pushInfo.id).then(text => {
                if (devEnv) log.debug("fetch结果: ", imageKey, text);
            }).catch(async err => {
                log.error(err);
                try {
                    const m = await import("../eventRec");
                    return await m.mailerError({ dynamicId }, new Error(strFormat(err)));
                } catch (err_1) {
                    return log.error(err_1);
                }
            });

            if (devEnv) { log.debug(dynamicId, pushInfo); break; }
            else await sleep(10 * 1000);
        }
        return;
    }

    const userCard = await getUserCard(item.modules.module_author.mid.toString());
    const userName = userCard.data.card.name;

    const guildId = Object.values(saveGuildsTree).find(v => Object.values(v.channels).find(v => v.id === pushInfo.id)?.id)?.id;
    const msg = new IMessageGUILD({ id: await redis.get(`lastestMsgId:${botType}`), guildId, channel_id: pushInfo.id, } as any, false);
    if (pushInfo.id == "544252608" && (devEnv || item.type == "DYNAMIC_TYPE_FORWARD"))
        return redis.hSet(`biliMessage:idPushed:${dynamicId}`, pushInfo.id, pushInfo.id);

    const imageUrl = cosUrl(`biliDynamic/${imageKey}`, imageBuffer.length < 4 * 1000 * 1000 ? "" : undefined);
    const { width: imgWidth, height: imgHeight } = imageSize(imageBuffer);

    await msg.sendMarkdown({
        sendType: pushInfo.type,
        imageUrl: imageUrl,
        params_omnipotent: [
            `${devEnv ? "dev " : ""}${userName} 更新了一条动态`,
            `[🔗https://t.bilibili`, `.com/${item.id_str}]`, `(https://t.bilibili`, `.com/${item.id_str})\r`,
            `![gui #${imgWidth}px #${imgHeight}px]`, `(${imageUrl})`,
            // `![img #px #px]`, `(${imageUrl})`,
        ],
        content: `${devEnv ? "dev " : ""}${userName} 更新了一条动态\nhttps://t.bilibili.com/${item.id_str}`,
    });

    return redis.hSet(`biliMessage:idPushed:${dynamicId}`, pushInfo.id, pushInfo.id);
}

export async function getUserCard(userId: string) {
    // https://api.bilibili.com/x/web-interface/card?mid=1
    return fetch(`https://api.bilibili.com/x/web-interface/card?mid=${userId}`, {
        headers: { "User-Agent": userAgent },
    }).then(res => res.json() as Promise<BiliUserCard.Root>);
}

//参考: https://github.com/SocialSisterYi/bilibili-API-collect/issues/686
export async function getCookie(): Promise<string> {
    const biliCookie = await redis.get("biliCookie") || "";
    const happy = await getUserDynamics("1", biliCookie).then(items => items.length != 0).catch(err => false);
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

    const newHappy = await getUserDynamics("1", newCookie).then(items => items.length != 0).catch(err => {
        log.error(err);
        return false;
    });
    if (devEnv) log.debug(`newHappy ${newHappy}`);

    if (newHappy) return newCookie;
    else throw "newCookie not happy";
}

export async function biliDynamicByid(msg: IMessageGROUP | IMessageC2C) {
    const dynamicId = msg.content.match(/\d+/)?.[0];
    if (!dynamicId) return;

    const imageBuffer = await screenshot(dynamicId, "");
    if (!imageBuffer) return msg.sendMsgEx({ content: `imageBuffer not found` });

    const imageKey = `0000-${dynamicId}-${new Date().getTime()}.png`;

    writeFileSync(`${config.imagesOut}/bili-${imageKey}`, imageBuffer);
    await cosPutObject({ Key: `biliDynamic/${imageKey}`, Body: imageBuffer, });
    if (devEnv) log.debug(`${config.imagesOut}/bili-${imageKey}`);

    const imageUrl = cosUrl(`biliDynamic/${imageKey}`, imageBuffer.length < 4 * 1000 * 1000 ? "" : undefined);

    await msg.sendMsgEx({
        imageUrl: imageUrl,
        content: `${imageKey}`,
    });

}

async function screenshot(dynamicId: string, pubTs: string, quality = 50): Promise<Buffer | undefined> {

    if (!global.browser || !browser.connected) global.browser = await puppeteer.launch({
        // headless: true,
        headless: !process.env.DISPLAY,
        args: ['--no-sandbox'],
        protocolTimeout: 240000,
    });

    const page = await browser.newPage();
    const cookies: puppeteer.Cookie[] = JSON.parse(readFileSync(browserCkFile).toString() || "[]");
    await page.setCookie(...cookies);
    await page.setUserAgent(userAgentAndroid);
    await page.setViewport({
        width: 500,
        height: 800,
        deviceScaleFactor: 3,
        isMobile: true,
    });
    await page.goto(`https://t.bilibili.com/${dynamicId}`, {
        waitUntil: ["networkidle0", "domcontentloaded"],
    });
    if (await page.$("#app > div > div > div.launch-app-btn.opus-module-blocked"))
        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
    await page.waitForNetworkIdle({
        idleTime: 1000,
        concurrency: 0,
    });

    await page.evaluate(() => {

        document.querySelector(`body > div.geetest_panel.geetest_wind`)?.remove();//删除验证码遮罩
        const r = "#app > div > div";
        document.querySelector(`#app > div > m-open-app.m-open-app.fixed-openapp.dynamic-float-btn`)?.remove(); // 删除打开 app
        document.querySelector(`#app > div > m-open-app.m-open-app.card-wrap > div > div.dyn-header > div.dyn-header__right > div`); // 删除关注按钮

        document.querySelector(`${r}.opus-nav`)?.remove();//删除nav
        document.querySelector(`${r}.m-navbar`)?.remove();//删除nav
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

        document.getElementsByClassName("m-fixed-openapp")?.[0]?.remove();
        document.getElementsByClassName("openapp-dialog")?.[0]?.remove();
        document.getElementsByClassName("dyn-header__following")?.[0]?.remove();
    });
    // debugger;
    const _ = await page.$(".dyn-card") || await page.$(".opus-modules") || await page.$("#app > div");
    if (!_) { await page.close(); return undefined; }
    const clip = {
        x: 0, y: 0,
        width: await _.evaluate((_: any) => _.scrollWidth || _?.offsetWidth),
        height: Math.min(5000, await _.evaluate((_: any) => _.scrollHeight || _?.offsetHeight)),
    };

    const b64 = await _.screenshot({
        type: "jpeg",
        encoding: "base64",
        quality,
        clip: clip,
    });
    // debugger;
    writeFileSync(browserCkFile, strFormat(await page.cookies()));
    if (!devEnv) await page.close();
    return Buffer.from(b64, "base64") || undefined;
}

async function getUserDynamics(biliUserId: string, cookies: string): Promise<BiliDynamic.Item[]> {

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
    }).then(res => res.json()).then((json: BiliDynamic.SpaceListRoot) => {
        //log.debug(json);
        if (!json.code) return json.data.items;
        throw json;
        //log.info(json.data.items);
    });
}

export async function getDynamicInfo(dynamicId: string): Promise<BiliDynamic.InfoRoot> {
    return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${dynamicId}`, {
        headers: {
            "User-Agent": userAgent,// userAgent,
            "Cookie": await getCookie(), //`SESSDATA=feilongproject.com;${cookies}`,
            "accept-language": "en,zh-CN;q=0.9,zh;q=0.8",
        }
    }).then(res => res.json());
}
