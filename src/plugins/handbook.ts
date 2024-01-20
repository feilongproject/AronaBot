import fs from "fs";
import RE2 from "re2";
import fetch from "node-fetch";
import format from "date-format";
import * as cheerio from "cheerio";
import imageSize from "image-size";
import { settingUserConfig } from "../libs/common";
import { IMessageDIRECT, IMessageGROUP, IMessageGUILD } from "../libs/IMessageEx";
import config from "../../config/config";

const noSetServerMessage = `\r(未指定/未设置服务器, 默认使用国际服)`;
const getErrorMessage = `发送时出现了一些问题<@${adminId[0]}>\n这可能是因为腾讯获取图片出错导致, 请稍后重试\n`;
const needUpdateMessage = `若数据未更新，请直接@bot管理, 或使用「查询攻略」功能`;
const updateTimeMessage = `图片更新时间：`;

const serverMap: Record<string, string> = { jp: "日服", global: "国际服", cn: "国服", all: "" };
const provideMap: Record<string, string> = { jp: "夜猫", global: "夜猫", cn: "朝夕desu", all: "夜猫" };


export async function handbookMain(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP) {
    const forceGuildType = ("guild_id" in msg && ["16392937652181489481"].includes(msg.guild_id)) ? "cn" : undefined;
    const hbMatched = await matchHandbook(msg.content.replaceAll(/<@!?\d+>/g, "").trim(), msg.author.id, forceGuildType).catch(err => JSON.stringify(err));
    // log.debug(msg.content, hbMatched);
    if (!hbMatched) return msg.sendMsgEx({ content: `未找到对应攻略数据` });
    if (typeof hbMatched == "string") return msg.sendMsgEx({ content: hbMatched });
    const lastestImage = await getLastestImage(hbMatched.name, hbMatched.type);
    const filePath = `${config.handbookRoot}/${hbMatched.name}/${hbMatched.type}.png`;

    const at_user = (msg instanceof IMessageGROUP ? `` : `<@${msg.author.id}> `) + `\u200b \u200b == ${serverMap[hbMatched.type] ?? hbMatched.nameDesc ?? hbMatched.type}${hbMatched.desc} == ${hbMatched.notChange ? noSetServerMessage : ""}`;
    return msg.sendMarkdown({
        markdownNameId: "common",
        params: {
            desc: at_user
                + `\r${needUpdateMessage}\r`
                + `攻略制作: ${provideMap[hbMatched.type]}\r`,
            ...(lastestImage.info ? { desc3: lastestImage.info + "\r" } : {}),
            link1: `${lastestImage.infoUrl ? "🔗详情点我" : "\u200b"}](${lastestImage.infoUrl || "https://ip.arona.schale.top/p/233"}`,
            img1: `img #${lastestImage.width}px #${lastestImage.height}px](${lastestImage.url}`,
            img1_status: `\r${lastestImage.updateTime}`,
            img2: "img #-1px #1px](  ",
        },
        keyboardNameId: "handbook",
        // markdown 部分

        content: at_user
            + `\n${needUpdateMessage}`
            + `\n攻略制作: ${provideMap[hbMatched.type]}`
            + `\n${lastestImage.info}`
            + `${lastestImage.infoUrl ? `\n详情: ${lastestImage.infoUrl}\n` : ""}`
            + lastestImage.updateTime,
        imageUrl: lastestImage.url,
        // fallback 部分
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({
            content: getErrorMessage + (err.errors.length ? (err.errors as string[]).join("\n") : JSON.stringify(err)).replaceAll(".", ",")
        });
    });

}

async function matchHandbook(content: string, aid: string, _hbType: string | undefined = undefined): Promise<{ name: string; nameDesc?: string; type: string; desc: string; notChange: boolean; } | undefined> {
    const handbookMatches = await import("../../data/handbookMatches");
    // const { names, types } = .handbookMatches as any as HandbookMatches;
    var nameDesc = "";
    const hbName = Object.entries(handbookMatches.match.names).find(([k, v]) => RegExp(v.reg).test(content));
    if (!hbName || !hbName[0]) return undefined;
    var hbType: string | undefined = _hbType || (hbName[1]?.has?.includes("all") ? "all" : ((Object.entries(handbookMatches.match.types).find(([k, v]) => RegExp(v).test(content)) || [])[0]) as any);
    if (handbookMatches.adapter[hbName[0]]) {
        const _ = await handbookMatches.adapter[hbName[0]](content, "GET");
        hbType = _.id;
        if (_.desc) nameDesc = _.desc;
    } else if (hbType != "all" && !hbType) {
        hbType = (await settingUserConfig(aid, "GET", ["server"])).server;
        if (!hbName[1].has.includes(hbType)) hbType = undefined;
    }
    return { name: hbName[0], nameDesc, type: hbType || _hbType || "global", ...hbName[1], notChange: !(hbType || _hbType) };
}

export async function getLastestImage(name: string, type = "all"): Promise<HandbookInfo.Data> {
    const updateTime = await redis.hGet("handbook:cache", `${name}:${type}`);
    const imageInfo = await redis.hGet("handbook:info", `${name}:${type}`);
    const infoUrl = await redis.hGet("handbook:infoUrl", `${name}:${type}`);
    const size = imageSize(`${config.handbookRoot}/${name}/${type}.png`);
    return {
        height: size.height || 400,
        width: size.width || 400,
        info: imageInfo || "",
        infoUrl: infoUrl || "",
        updateTime: updateTimeMessage + (updateTime || "未知"),
        url: await redis.hGet(`handbook`, `baseUrl`) + `/${name}/${type}.png!HandbookImageCompress?expired=${updateTime}`,
    };
}

export async function handbookUpdate(msg: IMessageGUILD) {
    if (!adminId.includes(msg.author.id)) return;
    const matched = new RE2("^/?hbupdate(?P<imageId>\\d+)?\\s+(?P<name>\\S+)\\s+(?P<type>\\S+)\\s+(?P<url>(https?://)?\\S+)\\s?(?P<desc>.+)?").exec(msg.content);
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
            imageType = (await handbookMatches.adapter[imageName](type)).id;
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
            const descUrl = /((https?:\/\/)?\S+)\s*/.exec(desc)![1];
            await fetch(descUrl.startsWith("https://") ? descUrl : "https://" + descUrl).then(res => {
                const matchDynamicId = (/https:\/\/t.bilibili.com\/(\d+)/.exec(res.url) || [])[1];
                if (matchDynamicId) return biliDynamicInfo(matchDynamicId);
                else throw `未知的url: ${res.url}`;
            }).then((data: BiliDynamic.Info) => {
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
            imageUrl = await fetch(url.startsWith("https://") ? url : "https://" + url).then(res => {
                // log.debug(res.url);
                const matchDynamicId = (/https:\/\/t.bilibili.com\/(\d+)/.exec(res.url) || [])[1];
                if (matchDynamicId) return biliDynamicInfo(matchDynamicId);
                else throw `未知的url: ${res.url}`;
            }).then((data: BiliDynamic.Info) => {
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
    } else if (/(https:\/\/)?.+hdslb\.com\/.+\.(png|jpg|jpeg)/.test(url)) imageUrl = /((https:\/\/)?.+\.(png|jpg|jpeg))/.exec(url)![1];
    if (!imageUrl) return msg.sendMsgExRef({ content: "图片未找到" });
    // 图片 URL 结束

    // 发送总结信息
    await msg.sendMsgEx({
        content: (`已判断完毕，正在下载`
            + `\nname: ${imageName}`
            + `\ntype: ${imageType}`
            + `\ndesc: ${imageDesc || ""}`
            + `\nimageTurnUrl: ${imageTurnUrl}`).replaceAll(".", ",")
    });

    await redis.hSet("handbook:cache", `${imageName}:${imageType}`, format.asString(new Date()));
    await redis.hSet("handbook:info", `${imageName}:${imageType}`, imageDesc || "");
    await redis.hSet("handbook:infoUrl", `${imageName}:${imageType}`, imageTurnUrl || "");
    await fetch(imageUrl.startsWith("http") ? imageUrl : `https://${imageUrl}`)
        .then(res => res.buffer())
        .then(buff => fs.writeFileSync(`${config.handbookRoot}/${imageName}/${imageType}.png`, buff));

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
            "Authorization": `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`
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
            "Authorization": `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`
        },
        body: JSON.stringify({ title: postInfo.title, content: postInfo.content, format: 2 }),
    })).then(res => res.text())
        .then(text => msg.sendMsgEx({ content: `已发布\n${text}` }))
        .catch(err => msg.sendMsgEx({ content: `获取出错\n${err}` }));
}

export async function searchHandbook(msg: IMessageGUILD | IMessageGROUP) {
    const matched = new RE2("^/?((查询|搜索)攻略|攻略(查询|搜索))\\s*(?P<searchKey>.+)$").exec(msg.content);
    if (!matched?.groups) return msg.sendMsgExRef({
        content: `请输入要查询的攻略！例：`
            + `\n/查询攻略 1-1`,
    });
    const searchWords = matched.groups?.searchKey;
    const resultData: DiyigemtAPI.Root = await fetch(`https://arona.diyigemt.com/api/v1/image?name=${searchWords}`).then(res => res.json());

    const imageUrl = `https://arona.cdn.diyigemt.com/image${resultData.data[0].path}?hash=${resultData.data[0].hash}`;
    if (resultData.data.length == 1) return msg.sendMarkdown({
        markdownNameId: "common",
        params: {
            desc: `<@${msg.author.id}>`
                + `\r数据来源: diyigemt`,
            link1: "\u200b](https://ip.arona.schale.top/p/233",
            img1: `img #1920px #1080px](${imageUrl}`,
            // img1_status: `\r${lastestImage.updateTime}`,
            img2: "img #-1px #1px](  ",
        },
        keyboardNameId: "handbook",
        // markdown 部分

        content: `<@${msg.author.id}>`
            + `\n数据来源: diyigemt`,
        imageUrl,
        // fallback 部分
    });
    else if (resultData.data.length > 1) return msg.sendMsgEx({
        content: `${msg instanceof IMessageGROUP ? `` : `<@${msg.author.id}>`} 模糊查询结果如下：\n` +
            resultData.data.map((v, i) => `第${i + 1} 搜索结果: ${v.name}`).join("\n"),
    });

}

async function biliDynamicInfo(dynamicId: string): Promise<BiliDynamic.Info> {
    const { getCookie, userAgent } = await import("./biliDynamic");
    return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${dynamicId}`, {
        headers: {
            "User-Agent": userAgent,// userAgent,
            "Cookie": await getCookie(), //`SESSDATA=feilongproject.com;${cookies}`,
            "accept-language": "en,zh-CN;q=0.9,zh;q=0.8",
        }
    }).then(res => res.json());
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

namespace DiyigemtAPI {
    export interface Root {
        status: 101 | 200;
        data: ResultList[];
        message: "name is empty" | "fuse search" | "wrong name";
    }

    interface ResultList {
        id: number;
        name: string;
        path: string;
        hash: string;
        type: number;
    }
}
