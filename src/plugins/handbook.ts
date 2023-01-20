import path from "path";
import fetch from "node-fetch";
import { readFileSync, writeFileSync } from "fs";
import * as cheerio from "cheerio";
import { settingUserConfig } from "../libs/common";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";
import config from "../../config/config.json";

const handbookData: HandbookData = JSON.parse(readFileSync(`${_path}/data/handbook/info.json`).toString());
const noSetServerMessage = `\n(未指定/未设置服务器, 默认使用国际服)`;

export async function totalAssault(msg: IMessageGUILD) {
    const { server, has } = await getServer(msg.content, msg.author.id);
    const lastestImage = await getLastestImage("totalAssault", server);
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (${server == "jp" ? "日服" : "国际服"}总力战一图流)` +
            (has ? "" : noSetServerMessage) +
            `\n攻略制作: 夜猫` + lastestImage.info,
        imageUrl: lastestImage.url,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: `获取出错<@${adminId[0]}>\n${JSON.stringify(err)}` });
    });
}

export async function globalClairvoyance(msg: IMessageGUILD) {
    const lastestImage = await getLastestImage("globalClairvoyance");
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (千里眼)` +
            `\n攻略制作: 夜猫` + lastestImage.info,
        imageUrl: lastestImage.url,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: `获取出错<@${adminId[0]}>\n${JSON.stringify(err)}` });
    });
}

export async function activityStrategy(msg: IMessageGUILD) {
    const { server, has } = await getServer(msg.content, msg.author.id);
    const lastestImage = await getLastestImage("activityStrategy", server);
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (${server == "jp" ? "日服" : "国际服"}活动一图流)` +
            (has ? "" : noSetServerMessage) +
            `\n攻略制作: 夜猫` + lastestImage.info,
        imageUrl: lastestImage.url,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: `获取出错<@${adminId[0]}>\n${JSON.stringify(err)}` });
    });
}

export async function activityStrategyPush(msg: IMessageDIRECT) {
    const reg = /攻略(发布|更新)\s*(cv(\d+))?\s*(\d+)?/.exec(msg.content)!;
    const cv = Number(reg[3]);
    const channelId = reg[4];

    if (!cv || !channelId) return msg.sendMsgEx({
        content: `无法解析cv或channelId` +
            `\ncv: ${cv}` +
            `\nchannelId: ${channelId}`,
    });

    const encode = cv.toString(2).replaceAll("0", "\u200c").replaceAll("1", "\u200d");
    const isNew = await fetch(`https://api.sgroup.qq.com/channels/${channelId}/threads`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`
        },
    }).then(res => res.json()).then(json => {
        for (const thread of json.threads) if ((thread.thread_info.title as string).startsWith(encode)) return false;
        return true;
    }).catch(err => log.error(err));
    if (!isNew) return msg.sendMsgEx({ content: `已查询到存在相同动态` });

    return fetch(`https://www.bilibili.com/read/cv${cv}`).then(res => res.text()).then(html => {
        const $ = cheerio.load(html);
        return eval(
            "const window={};" +
            $("script")
                .filter(function (i, el) { return $(this).text().startsWith("window.__INITIAL_STATE__"); })
                .text()
                .replace(/\(function\(\){.*}\(\)\)/, "")
        );
    }).then(async data => {
        const content =
            `<h1>该贴由BA彩奈bot自动爬取b站专栏并发送</h1>` +
            `<h1>作者: ${data.readInfo.author.name}</h1>` +
            `<h1>来源: https://www.bilibili.com/read/cv${cv}</h1>` +
            `<h1>\u200b</h1>` +
            (data.readInfo.content as string).replaceAll(`<img data-src="`, `<img src="`);
        const title: string = data.readInfo.title;
        return { title, content };
    }).then(postInfo => fetch(`https://api.sgroup.qq.com/channels/${channelId}/threads`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`
        },
        body: JSON.stringify({ title: encode + postInfo.title, content: postInfo.content, format: 2 }),
    })).then(res => res.text()).then(text => msg.sendMsgEx({ content: `已发布\n${text}` }));
}

async function getExpired(appname: string) {
    return redis.hGet("setting:expired", appname);
}

async function getServer(content: string, aid: string) {
    var hasServer: { server: "jp" | "global"; has: boolean; } = { server: "global", has: false };
    const cmdServer = /日|jp/.test(content) ? "jp" : (/国际|g/.test(content) ? "global" : undefined);
    if (cmdServer) hasServer = { server: cmdServer, has: true };
    const settingServer = (await settingUserConfig(aid, "GET", ["server"])).server as "jp" | "global" | undefined;
    if (settingServer) hasServer = { server: settingServer, has: true };
    return hasServer;
}

async function getLastestImage(appname: string, type = "all"): Promise<HandbookDataLastest> {
    const expired = await getExpired(`${appname}:${type}`);
    const lastestData = handbookData[appname].lastest[type];
    return {
        ...lastestData,
        url: handbookData["baseURL"].lastest + lastestData.url + `!HandbookImageCompress?expired=${expired}`,
    };
}

export async function purgeCache(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;

    const upyunToken = await redis.hGet("setting:global", "upyunToken");
    const redisHSetData: [string, string][] = [], _timestamp = new Date().getTime().toString();
    const lastestImageUrls: string[] = [];
    for (const appKey in handbookData) {
        const lastestData = handbookData[appKey].lastest;
        if (typeof lastestData == "string") continue;
        else for (const typeKey in lastestData) {
            lastestImageUrls.push(handbookData["baseURL"].lastest + lastestData[typeKey].url + `!HandbookImageCompress?expired=${_timestamp}`);
            redisHSetData.push([`${appKey}:${typeKey}`, _timestamp]);
        }
    }

    return redis.hSet("setting:expired", redisHSetData).then(() => {
        const sendStr = [`已设置缓存key值为${_timestamp}`];
        for (const [d] of redisHSetData) sendStr.push(d);
        return msg.sendMsgEx({ content: sendStr.join("\n") });
    }).then(() => fetch("https://api.upyun.com/purge", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${upyunToken}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({ "urls": lastestImageUrls.join("\n") }),
    })
    ).then(res => res.json()).then((json: UpyunPurge) => {
        const sendStr: string[] = ["刷新URL"];
        for (const _result of json.result) {
            const p = path.parse(new URL(_result.url).pathname);
            sendStr.push(`${p.dir}/${p.name}`, `> status: ${_result.status}, code: ${_result.code}`, ``);
        }
        return msg.sendMsgEx({ content: sendStr.join("\n") });
    }).then(async () => {
        const sendStr: string[] = ["fetchURL"];
        for (const url of lastestImageUrls) {
            await fetch(url, { headers: { "user-agent": "QQShareProxy" } }).then(res => {
                return res.buffer();
            }).then(buff => {
                const p = path.parse(new URL(url).pathname);
                sendStr.push(`${p.dir}/${p.name}`, `> status: ok`, ``);
                return writeFileSync(`/tmp/randPic/${new Date()}`, buff);
            });
        }
        return msg.sendMsgEx({ content: sendStr.join("\n") });
    });
}


interface HandbookData {
    [appname: string]: {
        lastest: {
            [type: string]: HandbookDataLastest;
        };
    };
}

interface HandbookDataLastest {
    url: string;
    info: string;
}

interface UpyunPurge {
    result: {
        code: number;
        status: string;
        task_id: string;
        url: string;
    }[];
}