import fetch from "node-fetch";
import path from "path";
import { settingConfig } from "../libs/common";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";
import { readFileSync } from "fs";

const handbookData: HandbookData = JSON.parse(readFileSync(`${_path}/data/handbook/info.json`).toString());

export async function onePictureTotalAssault(msg: IMessageGUILD) {
    const server = (await settingConfig(msg.author.id, "GET", ["server"])).server == "jp" ? "jp" : "global";
    const expired = await getExpired(`onePictureTotalAssault:${server}`);
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (${server == "jp" ? "日服" : "国际服"}总力战一图流)` +
            `\n攻略制作: 夜猫`,
        imageUrl: `${getLastestImageUrl("onePictureTotalAssault", server)}?expired=${expired}`,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: `获取出错<@${adminId[0]}>\n${JSON.stringify(err)}` });
    });
}

export async function globalClairvoyance(msg: IMessageGUILD) {
    const expired = await getExpired(`globalClairvoyance`);
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (千里眼)` +
            `\n攻略制作: 夜猫`,
        imageUrl: `${getLastestImageUrl("globalClairvoyance")}?expired=${expired}`,
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({ content: `获取出错<@${adminId[0]}>\n${JSON.stringify(err)}` });
    });
}

async function getExpired(appname: string) {
    return redis.hGet("setting:expired", appname);
}

function getLastestImageUrl(appname: string, type?: string): string {
    const appData = handbookData[appname].lastest;
    return (typeof appData == "string") ? appData : appData[type!];
}

function getLastestImageUrlAll() {
    const ret: string[] = [];
    for (const appKey in handbookData) {
        const appData = handbookData[appKey].lastest;
        if (typeof appData == "string") ret.push(appData);
        else for (const typeKey in appData)
            ret.push(appData[typeKey]);
    }
    return ret;
}

export async function purgeCache(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;

    const upyunToken = await redis.hGet("setting:global", "upyunToken");
    const lastestImageUrls = getLastestImageUrlAll().join("\n");

    const redisHSetData: [string, string][] = [], _timestamp = new Date().getTime().toString();
    for (const appKey in handbookData) {
        const appData = handbookData[appKey].lastest;
        if (typeof appData == "string") redisHSetData.push([appKey, _timestamp]);
        else for (const typeKey in appData)
            redisHSetData.push([`${appKey}:${typeKey}`, _timestamp]);
    }
    await redis.hSet("setting:expired", redisHSetData).then(() => {
        const sendStr = [`已设置缓存key值为${_timestamp}`];
        for (const [d] of redisHSetData) sendStr.push(d);
        return msg.sendMsgEx({ content: sendStr.join("\n") });
    }).then(() => {
        return fetch("https://api.upyun.com/purge", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${upyunToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ "urls": lastestImageUrls }),
        })
    }).then(res => {
        return res.json();
    }).then((json: UpyunPurge) => {
        const sendStr: string[] = ["刷新URL"];
        for (const _result of json.result) {
            const p = path.parse(new URL(_result.url).pathname);
            sendStr.push(`${p.dir}/${p.name}`, `> status: ${_result.status}, code: ${_result.code}`, ``);
        }
        return msg.sendMsgEx({ content: sendStr.join("\n") });
    }).then(() => {
        return fetch("https://api.upyun.com/preheat", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${upyunToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ "url": lastestImageUrls }),
        });
    }).then(res => {
        return res.json();
    }).then((json: UpyunPurge) => {
        const sendStr: string[] = ["预热URL"];
        for (const _result of json.result) {
            const p = path.parse(new URL(_result.url).pathname);
            sendStr.push(`${p.dir}/${p.name}`, `> status: ${_result.status}, code: ${_result.code}`, ``);
        }
        return msg.sendMsgEx({ content: sendStr.join("\n") });
    });
}


interface HandbookData {
    [appname: string]: {
        lastest: {
            [type: string]: string;
        } | string;
    };
}

interface UpyunPurge {
    result: {
        code: number;
        status: string;
        task_id: string;
        url: string;
    }[];
}