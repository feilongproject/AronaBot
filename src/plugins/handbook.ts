import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import imageSize from "image-size";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";
import { findStudentInfo, settingUserConfig } from "../libs/common";
import config from "../../config/config.json";

var handBookInfo: HandbookInfo.Root = JSON.parse(fs.readFileSync(`${config.picPath.handbookRoot}/info.json`).toString());
const noSetServerMessage = `\n(未指定/未设置服务器, 默认使用国际服)`;
const getErrorMessage = `发送时出现了一些问题<@${adminId[0]}>\n这可能是因为腾讯获取图片出错导致, 请稍后重试\n`;
const needUpdateMessage = `若数据未更新，请直接@bot管理`;
const updateTimeMessage = `图片更新时间：`;


export async function totalAssault(msg: IMessageGUILD) {
    const { server, message } = await getServer(msg.content, msg.author.id);
    const lastestImage = await getLastestImage("totalAssault", server);
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (${server == "jp" ? "日服" : "国际服"}总力战一图流)${message}` +
            `\n${needUpdateMessage}` +
            `\n攻略制作: 夜猫` +
            `\n${lastestImage.info}`,
        imageUrl: lastestImage.url,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: getErrorMessage + JSON.stringify(err) });
    });
}

export async function globalClairvoyance(msg: IMessageGUILD) {
    const lastestImage = await getLastestImage("globalClairvoyance");
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (千里眼)` +
            `\n${needUpdateMessage}` +
            `\n攻略制作: 夜猫` +
            `\n${lastestImage.info}`,
        imageUrl: lastestImage.url,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: getErrorMessage + JSON.stringify(err) });
    });
}

export async function activityStrategy(msg: IMessageGUILD) {
    const { server, message } = await getServer(msg.content, msg.author.id);
    const lastestImage = await getLastestImage("activityStrategy", server);
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (${server == "jp" ? "日服" : "国际服"}活动一图流)${message}` +
            `\n${needUpdateMessage}` +
            `\n攻略制作: 夜猫` +
            `\n${lastestImage.info}`,
        imageUrl: lastestImage.url,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: getErrorMessage + JSON.stringify(err) });
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

    return fetch(`https://www.bilibili.com/read/cv${cv}`, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36 Edg/112.0.1722.58" } }).then(res => res.text()).then(html => {
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
            `<h1>来源: <a href="https://www.bilibili.com/read/cv${cv}">https://www.bilibili.com/read/cv${cv}</a></h1>` +
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
    })).then(res => res.text())
        .then(text => msg.sendMsgEx({ content: `已发布\n${text}` }))
        .catch(err => msg.sendMsgEx({ content: `获取出错\n${err}` }));
}

export async function studentEvaluation(msg: IMessageGUILD) {
    const reg = /\/?(角评|角色评价)(.*)/.exec(msg.content)!;
    reg[2] = reg[2].trim();
    if (!reg[2]) {
        const lastestImage = await getLastestImage("studentEvaluation");
        return msg.sendMsgEx({
            content: `<@${msg.author.id}> (角评2.0)` +
                `\n未指定角色, 默认发送角评2.0` +
                `\n${needUpdateMessage}` +
                `\n攻略制作: 夜猫` +
                `\n${lastestImage.info}`,
            imageUrl: lastestImage.url,
        }).catch(err => {
            log.error(err);
            return msg.sendMsgEx({ content: getErrorMessage + JSON.stringify(err) });
        });
    }

    const studentInfo = reg[2] ? findStudentInfo(reg[2]) : null;
    if (!studentInfo) return msg.sendMsgExRef({ content: `未找到学生『${reg[2]}』数据` });

    const map = JSON.parse(fs.readFileSync(`${_path}/data/handbook/studentEvaluation/_map.json`).toString());
    const studentPathName = studentInfo.pathName;
    const imageLocalInfo: { info: string; path: string; } | undefined = map[studentPathName];

    if (!imageLocalInfo) return msg.sendMsgExRef({ content: `已找到学生『${reg[2]}』数据, 但未找到角评5.0, 等待后续录入<@${adminId[0]}>` });
    else return msg.sendMsgEx({
        content: `<@${msg.author.id}> (角评5.0)` +
            `\n${needUpdateMessage}` +
            `\n攻略制作: 夜猫` +
            `\n${imageLocalInfo.info}`,
        imagePath: `${_path}/data/handbook/studentEvaluation/${imageLocalInfo.path}`,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgExRef({ content: getErrorMessage + JSON.stringify(err) });
    });
}

async function getServer(content: string, aid: string) {
    var hasServer: { server: "jp" | "global"; message: string; } = { server: "global", message: undefined } as any;
    const cmdServer = /(日|jp)/.test(content) ? "jp" : (/(国际|g)/.test(content) ? "global" : undefined);
    if (cmdServer) hasServer = { server: cmdServer, message: "" };
    const settingServer = (await settingUserConfig(aid, "GET", ["server"])).server as "jp" | "global" | undefined;
    if (settingServer && !cmdServer) hasServer = { server: settingServer, message: "" };
    if (hasServer.message == undefined) hasServer.message = noSetServerMessage;
    return hasServer;
}

async function getLastestImage(appname: string, type = "all"): Promise<HandbookInfo.Data> {
    const lastestData = handBookInfo[appname][type];
    const size = imageSize(`${config.picPath.handbookRoot}/${appname}/${type}.png`);
    return {
        ...size as any,
        info: updateTimeMessage + lastestData.updateTime + lastestData.info,
        updateTime: lastestData.updateTime,
        url: await redis.hGet(`cache:handbook`, `baseUrl`) + `/${appname}/${type}.png!HandbookImageCompress?expired=${lastestData.updateTime}`,
    };
}

export async function flushHandBookInfo(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    handBookInfo = JSON.parse(fs.readFileSync(`${_path}/data/handbook/info.json`).toString());
    const preheatList: (HandbookInfo.Data & { field: string; isNew: boolean; })[] = [];

    for (const appname in handBookInfo) {
        for (const type in handBookInfo[appname]) {
            const data = await getLastestImage(appname, type);
            const _updateTime = await redis.hGet(`cache:handbook`, `${appname}:${type}`);
            preheatList.push({
                ...data,
                field: `${appname}:${type}`,
                isNew: _updateTime != data.updateTime,
            });
        }
    }

    for (let i = 0; i < preheatList.length; i++) {
        const data = preheatList[i];
        const p = path.parse(new URL(data.url).pathname);

        await fetch(data.url, {
            headers: { "user-agent": "QQShareProxy" },
        }).then(res => res.buffer()).then(buff => msg.sendMsgEx({
            content: `${i + 1}/${preheatList.length}  ----  ${data.updateTime}` +
                `\n${p.dir}/${p.name}` +
                `\nsize: ${(buff.length / 1024).toFixed(2)}K ---- ${data.width}x${data.height}` +
                `\nisNew: ${data.isNew}`,
        })).then(() => redis.hSet(`cache:handbook`, data.field, data.updateTime)).catch(err => {
            log.error(err);
            msg.sendMsgEx({ content: JSON.stringify(err).replaceAll(".", "。") });
        }).catch(() => { });
    }
}


namespace HandbookInfo {
    export interface Root {
        [appname: string]: {
            [type: string]: Data;
        };
    }

    export interface Data {
        height: number;
        width: number;
        url: string;
        info: string;
        updateTime: string;
    }
}
