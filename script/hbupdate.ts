import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import readline from "readline";
import format from "date-format";
import { createClient } from "redis";
import config from "../config/config";
import { execSync } from "child_process";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
var url = "";
var status = 0;
const statusPrompt = ["type> ", "type pathname> "];

global.redis = createClient({
    socket: { host: "127.0.0.1", port: 6379, },
    database: 0,
});
global.adminId = [];
global.studentInfo = JSON.parse(fs.readFileSync(config.studentInfo).toString());

const redis = global.redis;
const imageName = "studentEvaluation";


async function main(input: string) {
    if (!input) return;

    const matched = /(?<imageId>\d\s+)?(?<type>\S+)\s+(?<url>(https?:\/\/)?\S+)\s?(?<desc>.+)?/.exec(input);
    if (!matched?.groups) return console.log("未matched");
    const { type, url, imageId } = matched?.groups;

    const imageUrl = await findUrl(url, Number(imageId) || undefined);
    if (!imageUrl) return console.log("未匹配到url");

    // debugger;

    const handbookMatches = await import("../data/handbookMatches");
    const hbMatched = await handbookMatches.adapter[imageName](type).catch(err => console.error(err));
    if (!hbMatched) return;
    console.log(`matched: ${hbMatched.id} ${hbMatched.desc}`);
    const imageType = hbMatched.id;

    // 预览原图
    if (fs.existsSync(`${config.handbookRoot}/${imageName}/${imageType}.png`))
        execSync(`imgcat ${config.handbookRoot}/${imageName}/${imageType}.png`, { stdio: 'inherit' });

    // 存入本地与数据库
    await redis.hSet("handbook:cache", `${imageName}:${imageType}`, format.asString(new Date()));
    await redis.hSet("handbook:info", `${imageName}:${imageType}`, "");
    await redis.hSet("handbook:infoUrl", `${imageName}:${imageType}`, "");
    await fetch(imageUrl.startsWith("http") ? imageUrl : `https://${imageUrl}`)
        .then(res => res.buffer())
        .then(buff => fs.writeFileSync(`${config.handbookRoot}/${imageName}/${imageType}.png`, buff));
    console.log("set ok");


    // 预热图片
    const lastestImage = await (await import("../src/plugins/handbook")).getLastestImage(imageName, imageType);
    console.debug(lastestImage);
    await fetch(lastestImage.url, {
        headers: { "user-agent": "QQShareProxy" },
        timeout: 60 * 1000,
    }).then(res => res.buffer()).then(buff => console.log(`${imageName} ${imageType}\nsize: ${(buff.length / 1024).toFixed(2)}K`)).catch(err => console.error(err));
    // 

    // 预览最终输出图
    execSync(`imgcat ${config.handbookRoot}/${imageName}/${imageType}.png`, { stdio: 'inherit' });
    console.log("refetch ok");
}


rl.on("line", input => main(input).then(() => setPrompt(statusPrompt[status])).catch(() => setPrompt(statusPrompt[status])));


async function findUrl(url: string, imageId = 0) {
    var imageUrl;
    if (/(arona\.schale\.top\/turn)|(t\.bilibili\.com\/(\d+))/.test(url)) {
        try {
            imageUrl = await fetch(url.startsWith("https://") ? url : "https://" + url).then(res => {
                // log.debug(res.url);
                const matchDynamic = /https:\/\/t.bilibili.com\/(\d+)/.exec(res.url);
                if (matchDynamic) return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${matchDynamic[1]}`, {
                    headers: {
                        "User-Agent": "Mozilla/5.0",// userAgent,
                        "Cookie": "SESSDATA=feilongproject.com;", //cookies, //`SESSDATA=feilongproject.com;${cookies}`,
                    }
                });
                else throw `未知的url: ${res.url}`;
            }).then(res => res.json()).then((data) => {
                const draw = data.data.item.modules.module_dynamic.major.draw;
                // log.debug(draw);
                if (!draw) throw `未找到指定动态中的图片`;
                if (Number(imageId) <= 0 || Number(imageId) > draw.items.length) throw `查询图片 id:${imageId} 超出范围，范围: 1 - ${draw.items.length}`;
                return draw.items[Number(imageId) - 1 || 0].src;
            });
        } catch (err) {
            console.error(err);
            return; // msg.sendMsgEx({ content: `查找图片时出现错误\n` + JSON.stringify(err).replaceAll(".", ",") });
        }
    } else if (/(https:\/\/)?.+hdslb\.com\/.+\.(png|jpg|jpeg)/.test(url)) imageUrl = /((https:\/\/)?.+\.(png|jpg|jpeg))/.exec(url)![1];
    if (!imageUrl) return; // msg.sendMsgExRef({ content: "图片未找到" });

    return imageUrl;
}


function setPrompt(prompt: string) {
    rl.setPrompt(prompt);
    rl.prompt();
}



(async () => {
    await global.redis.connect().then(() => {
        console.log(`初始化: redis 数据库连接成功`);
        setPrompt(statusPrompt[status]);
    }).catch(err => {
        console.error(`初始化: redis 数据库连接失败，正在退出程序\n${err}`);
        process.exit();
    });
})();