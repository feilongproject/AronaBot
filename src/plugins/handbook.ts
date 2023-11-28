import fs from "fs";
import RE2 from "re2";
import fetch from "node-fetch";
import format from "date-format";
import * as cheerio from "cheerio";
import imageSize from "image-size";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";
import { findStudentInfo, settingUserConfig } from "../libs/common";
import config from "../../config/config";

const noSetServerMessage = `\r(未指定/未设置服务器, 默认使用国际服)`;
const getErrorMessage = `发送时出现了一些问题<@${adminId[0]}>\n这可能是因为腾讯获取图片出错导致, 请稍后重试\n`;
const needUpdateMessage = `若数据未更新，请直接@bot管理`;
const updateTimeMessage = `图片更新时间：`;

const serverMap: Record<string, string> = { jp: "日服", global: "国际服", all: "" };


export async function handbookMain(msg: IMessageGUILD | IMessageDIRECT) {
    const hbMatched = await matchHandbook(msg.content.replaceAll(RegExp(`<@!?${meId}>`, "g"), "").trim(), msg.author.id).catch(err => JSON.stringify(err));
    // log.debug(msg.content, hbMatched);
    if (!hbMatched) return msg.sendMsgEx({ content: `未找到对应攻略数据` });
    if (typeof hbMatched == "string") return msg.sendMsgEx({ content: hbMatched });
    const lastestImage = await getLastestImage(hbMatched.name, hbMatched.type);
    const filePath = `${config.handbookRoot}/${hbMatched.name}/${hbMatched.type}.png`;

    const at_user = `<@${msg.author.id}> \u200b \u200b == ${serverMap[hbMatched.type] ?? hbMatched.nameDesc ?? hbMatched.type}${hbMatched.desc} == ${hbMatched.notChange ? noSetServerMessage : ""}`;
    return msg.sendMarkdown({
        templateId: "102024160_1694664174",
        params: {
            at_user,
            desc1: `\r${needUpdateMessage}\r`,
            desc2: `攻略制作: 夜猫\r`,
            ...(lastestImage.info ? { desc3: lastestImage.info + "\r" } : {}),
            link1: `${lastestImage.infoUrl ? "🔗详情点我" : "\u200b"}](${lastestImage.infoUrl || "https://ip.arona.schale.top/turn/"}`,
            img1: `img #${lastestImage.width}px #${lastestImage.height}px](${lastestImage.url}`,
            img1_status: `\r${lastestImage.updateTime}`,
            img2: "img #-1px #1px](  ",
        },
        keyboardId: "102024160_1694010888",
        // markdown 部分

        content: at_user
            + `\n${needUpdateMessage}`
            + `\n攻略制作: 夜猫`
            + `\n${lastestImage.info}`
            + `${lastestImage.infoUrl ? `\n详情: ${lastestImage.infoUrl}\n` : ""}`
            + lastestImage.updateTime,
        imageUrl: lastestImage.url,
        // fallback 部分
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: getErrorMessage + JSON.stringify(err).replaceAll(".", ",") });
    });

}

async function matchHandbook(content: string, aid: string): Promise<{ name: string; nameDesc?: string; type: string; desc: string; notChange: boolean; } | undefined> {
    const handbookMatches = await import("../../data/handbookMatches");
    // const { names, types } = .handbookMatches as any as HandbookMatches;
    var nameDesc = "";
    const hbName = (Object.entries(handbookMatches.match.names).find(([k, v]) => RegExp(v.reg).test(content)));
    if (!hbName || !hbName[0]) return undefined;
    var hbType: string = hbName[1]?.has?.includes("all") ? "all" : ((Object.entries(handbookMatches.match.types).find(([k, v]) => RegExp(v).test(content)) || [])[0]) as any;
    if (handbookMatches.adapter[hbName[0]]) {
        const _ = handbookMatches.adapter[hbName[0]](content, "GET");
        hbType = _.id;
        if (_.desc) nameDesc = _.desc;
    } else if (hbType != "all" && !hbType) {
        hbType = (await settingUserConfig(aid, "GET", ["server"])).server;
    }
    return { name: hbName[0], nameDesc, type: hbType || "global", ...hbName[1], notChange: !hbType };
}

async function getLastestImage(name: string, type = "all"): Promise<HandbookInfo.Data> {
    const updateTime = await redis.hGet("handbook:cache", `${name}:${type}`);
    const imageInfo = await redis.hGet("handbook:info", `${name}:${type}`);
    const infoUrl = await redis.hGet("handbook:infoUrl", `${name}:${type}`);
    const size = imageSize(`${config.handbookRoot}/${name}/${type}.png`);
    return {
        height: size.height || 400,
        width: size.width || 400,
        info: imageInfo,
        infoUrl: infoUrl || "",
        updateTime: updateTimeMessage + updateTime,
        url: await redis.hGet(`handbook`, `baseUrl`) + `/${name}/${type}.png!HandbookImageCompress?expired=${updateTime}`,
    };
}

export async function handbookUpdate(msg: IMessageGUILD) {
    if (!adminId.includes(msg.author.id)) return;
    const matched = new RE2("^/?hbupdate(?P<imageId>\\d+)?\\s+(?P<name>\\S+)\\s+(?P<type>\\S+)\\s+(?P<url>https?://\\S+)\\s?(?P<desc>.+)?").exec(msg.content);
    // log.debug(matched?.groups);
    if (!matched || !matched.groups) return msg.sendMsgExRef({
        content: `命令错误，命令格式：` +
            `/hbupdate[imageId] (name) (type) (url) [desc]`,
    });

    const { imageId, name, type, url, desc } = matched.groups;

    // 图片 name 开始
    var imageName = "";
    const matchNames = ((await import("../../data/handbookMatches")).match as any as HandbookMatches).names;
    for (const _key in matchNames) {
        if (RegExp(matchNames[_key].typeReg).test(name)) { imageName = _key; break; }
    }
    if (!imageName) return msg.sendMsgEx({ content: `${name} 未找到` });
    // 图片 name 结束

    // 图片 type 开始
    var imageType = type;
    const handbookMatches = await import("../../data/handbookMatches");
    if (handbookMatches.adapter[imageName]) {
        try {
            imageType = handbookMatches.adapter[imageName](type).id;
        } catch (err) {
            log.error(err);
            return msg.sendMsgEx({ content: `判断图片type时出现错误\n` + JSON.stringify(err).replaceAll(".", ",") });
        }
    } else if (!Object.hasOwnProperty.call(serverMap, type))
        return msg.sendMsgEx({ content: `未找到类型 ${type} ，允许类型： ${Object.keys(serverMap)}` });
    else if (!matchNames[imageName] || !matchNames[imageName]?.has?.includes(type as any))
        return msg.sendMsgEx({ content: `${imageName} 中未找到类型 ${type} ，仅支持 ${matchNames[imageName].has}` });
    // 图片 type 结束

    // 图片 desc turnUrl 开始
    var imageDesc = "";
    var imageTurnUrl = "";
    if (/(arona\.schale\.top\/turn)|(t\.bilibili\.com\/(\d+))/.test(desc)) {
        try {
            await fetch(/(https?:\/\/\S+)\s*/.exec(desc)![1]).then(res => {
                const matchDynamicId = /https:\/\/t.bilibili.com\/(\d+)/.exec(res.url);
                // log.debug(matchDynamicId);
                if (matchDynamicId) return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${matchDynamicId[1]}`, {
                    headers: {
                        "User-Agent": "Mozilla/5.0",// userAgent,
                        "Cookie": "SESSDATA=feilongproject.com;", //cookies, //`SESSDATA=feilongproject.com;${cookies}`,
                    }
                });
                else throw `未知的url: ${res.url}`;
            }).then(res => res.json()).then((data: BiliDynamic.Info) => {
                if (data.data.item.modules.module_dynamic.major.type == BiliDynamic.MajorTypeEnum.MAJOR_TYPE_ARTICLE) {
                    const article = data.data.item.modules.module_dynamic.major.article!;
                    const cvId = /cv(\d+)/.exec(article.jump_url)![1];
                    imageTurnUrl = `https://bilibili.com/read/cv${cvId}`;
                    imageDesc = article.title.replaceAll(/((蔚|碧)蓝档案)/g, "").replace(/^\//, "").trim();
                } else throw `未知的动态类型: ${data.data.item.modules.module_dynamic.major.type}`;
            });
        } catch (err) {
            log.error(err);
            return msg.sendMsgEx({ content: `解析desc时出现错误\n` + JSON.stringify(err).replaceAll(".", ",") });
        }
    } else if (/cv(\d+)/.test(desc)) {
        imageTurnUrl = `https://bilibili.com/read/cv${/cv(\d+)/.exec(desc)![1]}`;
    } else imageDesc = desc || "";
    // 图片 desc turnUrl 结束

    // 图片 URL 开始
    var imageUrl = "";
    if (/(arona\.schale\.top\/turn)|(t\.bilibili\.com\/(\d+))/.test(url)) {
        try {
            imageUrl = await fetch(url).then(res => {
                // log.debug(res.url);
                const matchDynamic = /https:\/\/t.bilibili.com\/(\d+)/.exec(res.url);
                if (matchDynamic) return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${matchDynamic[1]}`, {
                    headers: {
                        "User-Agent": "Mozilla/5.0",// userAgent,
                        "Cookie": "SESSDATA=feilongproject.com;", //cookies, //`SESSDATA=feilongproject.com;${cookies}`,
                    }
                });
                else throw `未知的url: ${res.url}`;
            }).then(res => res.json()).then((data: BiliDynamic.Info) => {
                const draw = data.data.item.modules.module_dynamic.major.draw;
                // log.debug(draw);
                if (!draw) throw `未找到指定动态中的图片`;
                if (Number(imageId) <= 0 || Number(imageId) > draw.items.length) throw `查询图片 id:${imageId} 超出范围，范围: 1 - ${draw.items.length}`;
                return draw.items[Number(imageId) - 1 || 0].src;
            });
        } catch (err) {
            log.error(err);
            return msg.sendMsgEx({ content: `查找图片时出现错误\n` + JSON.stringify(err).replaceAll(".", ",") });
        }
    } else if (/https:\/\/.+hdslb\.com\/.+\.(png|jpg|jpeg)/.test(url)) imageUrl = /(https:\/\/.+\.(png|jpg|jpeg))/.exec(url)![1];
    if (!imageUrl) return msg.sendMsgExRef({ content: "图片未找到" });
    // 图片 URL 结束

    // 发送总结信息
    await msg.sendMsgEx({
        content: (`已判断完毕，正在下载`
            + `\nname: ${imageName}`
            + `\ntype: ${imageType}`
            + `\ndesc: ${imageDesc || "空"}`
            + `\nimageTurnUrl: ${imageTurnUrl}`).replaceAll(".", ",")
    });

    await redis.hSet("handbook:cache", `${imageName}:${imageType}`, format.asString(new Date()));
    await redis.hSet("handbook:info", `${imageName}:${imageType}`, imageDesc || "");
    await redis.hSet("handbook:infoUrl", `${imageName}:${imageType}`, imageTurnUrl || "");
    await fetch(imageUrl).then(res => res.buffer()).then(buff => fs.writeFileSync(`${config.handbookRoot}/${imageName}/${imageType}.png`, buff));

    const lastestImage = await getLastestImage(imageName, imageType);
    if (devEnv) log.debug(lastestImage);
    await fetch(lastestImage.url, {
        headers: { "user-agent": "QQShareProxy" },
        timeout: 60 * 1000,
    }).then(res => res.buffer()).then(buff => msg.sendMsgEx({
        content: `${imageName} ${imageType} ${(imageDesc || "").replaceAll(".", ",")}\nsize: ${(buff.length / 1024).toFixed(2)}K`,
    })).catch(err => log.error(err));

    return msg.sendMsgEx({
        content: `图片已缓存`,
        imageUrl: lastestImage.url,//imageUrl + "@1048w_!web-dynamic.jpg",
    });
}

export async function activityStrategyPush(msg: IMessageGUILD | IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    const reg = /攻略(发布|更新)\s*(cv(\d+))?\s*(\d+)?/.exec(msg.content)!;
    const cv = Number(reg[3]);
    const channelId = reg[4];

    if (!cv || !channelId) return msg.sendMsgEx({
        content: `无法解析cv或channelId` +
            `\ncv: ${cv}` +
            `\nchannelId: ${channelId}`,
    });

    const encode = cv.toString(2).replaceAll("0", "\u200c").replaceAll("1", "\u200d");
    const isHas = await fetch(`https://api.sgroup.qq.com/channels/${channelId}/threads`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`
        },
    }).then(res => res.json()).then(json => (json.threads as any[]).find(thread => (thread.thread_info.title as string).startsWith(encode))).catch(err => log.error(err));
    if (isHas) return msg.sendMsgEx({ content: `已查询到存在相同动态` });

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
            `<h1>该贴由BA彩奈bot自动爬取b站专栏并发送</h1>`
            + `<h1>作者: ${data.readInfo.author.name}</h1>`
        // + `<h1>来源: <a href="https://www.bilibili.com/read/cv${cv}">https://www.bilibili.com/read/cv${cv}</a></h1>`
        // + `<h1>\u200b</h1>`
        // + (data.readInfo.content as string).replaceAll(`<img data-src="`, `<img src="`);
        const title: string = data.readInfo.title;
        return { title, content };
    }).then(postInfo => fetch(`https://api.sgroup.qq.com/channels/${channelId}/threads`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`
        },
        body: JSON.stringify({ title: postInfo.title, content: postInfo.content, format: 2 }),
    })).then(res => res.text())
        .then(text => msg.sendMsgEx({ content: `已发布\n${text}` }))
        .catch(err => msg.sendMsgEx({ content: `获取出错\n${err}` }));
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
        info?: string;
        infoUrl?: string;
        updateTime: string;
    }
}

interface HandbookMatches {
    names: Record<string, {
        reg: string;
        typeReg: string;
        has: ["jp" | "global" | "all"];
        desc: string;
    }>;
    types: Record<string, string>;
}
