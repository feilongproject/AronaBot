import crypto from "crypto";
import fetch from "node-fetch";
import FormData from "form-data";
import imageSize from "image-size";
import * as cheerio from "cheerio";
import { Button } from "qq-bot-sdk";
import { IMessageC2C, IMessageGROUP } from "../libs/IMessageEx";


const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0";
let M = 4556179899441;
const MinSimilar = 25;
const MAX_LEN = 3;
export async function soutubot(msg: IMessageGROUP | IMessageC2C) {
    if (await notCanUse(msg)) return msg.sendMsgEx({ content: `无权限使用` });
    if (msg.attachments?.length !== 1) return msg.sendMsgEx({ content: `图片数量只能为一张，不可少图不可多图` });

    const commands = msg.content.split(" ").map(v => v.split("=")).filter(v => (v.length > 0) && (v.length <= 2)) as [string, string?][];
    const useLowSimilar = !!commands.find(v => v[0].includes("-low"));
    const useLang = ((commands.find(v => v[0].includes("-lang")) || [])[1] || "cn,jp,en").split(",");

    const html = await fetch("https://soutubot.moe").then(res => res.text());
    const $ = cheerio.load(html);
    const eles = $("script");
    for (const ele of eles) {
        const h = $(ele).html() || "";
        if (!h.includes("window.GLOBAL")) continue;
        const match = h
            .replace(/window\.GLOBAL =/g, "")
            .replace(/JSON\.parse\(.+\)/g, "''")
            .replace(/ |\n|\r/g, "")
            .trim()
            .match(/{siteConfig:'',m:(?<M>\d+),}/);
        M = Number(match?.groups?.M);
        // debugger;
    }

    const fileData = await fetch(msg.attachments[0].url).then(res => res.buffer());
    await msg.sendMsgEx({ content: `搜索中，请稍后` });

    const _ = (Math.pow(Math.floor(Date.now() / 1000), 2) + Math.pow(UA.length, 2) + M).toString();
    const apiKey = btoa(_).split('').reverse().join('').replace(/=/g, '');
    const from = new FormData();
    from.append("factor", "1.2");
    from.append("file", fileData, { filename: "image" });

    const res = await fetch("https://soutubot.moe/api/search", {
        method: "POST",
        headers: {
            ...from.getHeaders(),
            "x-api-key": apiKey,
            "authority": "soutubot.moe",
            "origin": "https://soutubot.moe",
            "referer": "https://soutubot.moe/",
            "x-requested-with": "XMLHttpRequest",
        },
        body: from,
    });
    if (res.status != 200) return msg.sendMsgEx({ content: `搜索失败，错误码${res.status}` });
    const json: SoutuBot.Root = await res.json();
    const { data: resData } = json;
    if (resData.length == 0) return msg.sendMsgEx({ content: `搜索完成，未找到结果` });
    if (!resData.find(v => v.similarity >= MinSimilar)) return msg.sendMsgEx({
        content: `搜索结果中不存在匹配度大于${MinSimilar}%内容`
            + `详情请看：\nhttps://soutubot\u200b.moe/results/${json.id}`
    });

    const filterData = await Promise
        .all(resData
            .filter(v => useLowSimilar || v.similarity >= MinSimilar)
            .filter(v => useLang.includes(v.language))
            .reduce((acc, item) => {
                const count = acc.urlMap.get(item.subjectPath) || 0;
                if (count < 2) {
                    acc.urlMap.set(item.subjectPath, count + 1);
                    acc.filteredData.push(item);
                }
                return acc;
            }, { urlMap: new Map(), filteredData: [] as SoutuBot.Data[] }).filteredData
            .slice(0, MAX_LEN)
            .map(v => fetch(v.previewImageUrl).then(res => res.buffer()).then(buff => {
                const size = imageSize(buff);
                const { width, height } = size;
                const r = Math.max(1, (height || 0) / 150);
                const w = Math.floor((width || 0) / r);
                const h = Math.floor((height || 0) / r);
                v.title = v.title.replaceAll("[", "【").replaceAll("]", "】");
                return { ...v, buff, width: w, height: h };
            }))
        );


    const genKeyboard = (show: string, input: string, id?: string): Button => ({
        id: id || `${show}`,
        render_data: { label: show, style: 1 },
        action: { type: 0, permission: { type: 2 }, data: input },
    });
    const r = () => crypto.randomUUID().slice(0, 4);
    const keyBoardRows = filterData.map((v, i) => {
        if (!SiteMap[v.source]) return { buttons: [genKeyboard(`${v.source} ${v.pagePath}`, `${v.pagePath}`)] };
        return {
            buttons: [
                ...SiteMap[v.source].variants.map(d => [
                    genKeyboard(`${d.name}`, `${d.host}${v.subjectPath}`, `${i}-${d.name}-${r()}`),
                    genKeyboard(`${d.name}-P${v.page}`, `${d.host}${v.pagePath}`, `${i}-${d.name}-${v.page}-${r()}`),
                ]).flat(),
            ]
        };
    });

    // debugger;
    await msg.sendMsgEx({ content: `搜索结果: https://soutubot\u200b.moe/results/${json.id}` });
    // return;
    await msg.sendMarkdown({
        params_omnipotent: [
            `搜索完成，共 ${filterData.length} 条结果，其中 ${resData.length - filterData.length} 条被过滤\r`,
            ...filterData.map(v => [
                `\r![img #${v.width}px #${v.height}px]`, `(${v.previewImageUrl})`,
                `\u200b  \u200b  ${v.similarity} | ${v.language.toUpperCase()} | ${v.page}\r`,
                ..."`".repeat(3), "\r",
                `${v.title}`,
                `\r`, ..."`".repeat(3), `\r`,
            ]).flat(),
        ],
        content: `搜索完成，共 ${filterData.length} 条结果，其中 ${resData.length - filterData.length} 条被过滤\n`,
        keyboard: {
            content: {
                rows: [
                    // { buttons: [genKeyboard("搜索结果页面", `https://soutubot.moe/results/${json.id}`, "result-page")] },
                    ...keyBoardRows,
                ],
            }
        },
    });
}

async function notCanUse(msg: IMessageC2C | IMessageGROUP): Promise<boolean> {
    if (adminId.includes(msg.author.id)) return false;
    if (msg instanceof IMessageGROUP && ["963547B9CDEF3C2F51F2C02AC06B808B"].includes(msg.group_id)) return false;
    if (await redis.sIsMember(`auth:usebot:soutu:user`, msg.author.id)) return false;
    if (msg instanceof IMessageGROUP && await redis.sIsMember(`auth:usebot:soutu:group`, msg.group_id)) return false;
    return true;
}

const SiteMap = {
    nhentai: {
        label: "nHentai",
        variants: [{
            name: "NH",
            host: "nhentai.net"
        }, {
            name: "NHX",
            host: "nhentai.xxx"
        }]
    },
    ehentai: {
        label: "E-Hentai / ExHentai",
        variants: [{
            name: "EH",
            host: "e-hentai.org"
        }, {
            name: "ExH",
            host: "exhentai.org"
        }]
    },
    panda: {
        label: "Panda Backup",
        variants: [{
            name: "Panda",
            host: "panda.chaika.moe"
        }]
    }
};


namespace SoutuBot {
    export interface Root {
        data: Data[];
        id: string;
        factor: number;
        imageUrl: string;
        searchOption: string;
        executionTime: number;
    }

    export interface Data {
        source: Source;
        page: number;
        title: string;
        language: Language;
        pagePath: string;// '/g/524361/11',
        subjectPath: string; // '/g/524361',
        previewImageUrl: string;
        similarity: number;
    };

    export const enum Source {
        NH = "nhentai",
        EH = "ehentai",
    }

    export const enum Language {
        JP = "jp",
        CN = "cn",
        GB = "gb",
    }
}
