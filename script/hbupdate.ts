global.adminId = [];


import fs from "fs";
import fetch from "node-fetch";
import readline from "readline";
import COS from "cos-nodejs-sdk-v5";
import { createClient } from "redis";
import { execSync } from "child_process";
import { handbookMatches, studentEvaluation, getLastestImage } from "../src/plugins/handbook";
import config from "../config/config";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
var status: Status = Status.TYPE;

const enum Status {
    TYPE = "TYPE", // 图片类型，接受一个参数（角评/攻略等）
    URL = "URL", // 动态链接，接受一个url参数
    // IV = "IV", // iv+name，接受两个参数，动态图片iv与name（国服/国寄服等）
}
// const statusPromptV1: Status[] = [];
const statusData: Record<Status, string> = { TYPE: "", URL: "", };

global.redis = createClient(config.redis);
global.studentInfo = JSON.parse(fs.readFileSync(config.studentInfo).toString());
global.stringifyFormat = (obj: any) => JSON.stringify(obj, undefined, "    ");
global.sleep = (ms: number) => new Promise(resovle => { setTimeout(resovle, ms) });
global.fixName = (name: string) => name.replace("（", "(").replace("）", ")").toLowerCase().replaceAll(" ", "").replace(/(国际?服|日服)/g, "");
global.cosPutObject = async (params: CosPutObjectParams) => cos.putObject({ ...config.cos, ...params, });
global.cosUrl = (key: string, fix = "!Image3500K") => `${config.cosUrl}/${key}${fix || ""}`;


const redis = global.redis;
const serverMap: Record<string, string> = { jp: "日服", global: "国际服", cn: "国服", all: "" };


async function main(input: string) {

    const matchNames = handbookMatches.names;

    if (status == Status.TYPE) {
        const [hbMatchedType, hbMatchedName] = Object.entries(matchNames).find(([k, v]) => v.reg.test(input)) || [];
        if (!hbMatchedType || !hbMatchedName) return console.log("未匹配到攻略类型");
        console.log(`已匹配到类型: ${hbMatchedName.desc}(${hbMatchedType})`);
        status = Status.URL;
        return statusData.TYPE = hbMatchedType;
    }

    if (status == Status.URL) {

        const matched = /^(?<imageId>\d+)?\s?(?<type>\S+)\s+(?<url>(https?:\/\/)\S+)\s?(?<desc>.+)?/.exec(input);
        // const matched = /(?<url>(https?:\/\/)?\S+)\s?(?<desc>.+)?/.exec(input);
        if (!matched?.groups) return console.log("url未matched");
        const { type: _imageType, url: _imageUrl, desc: imageDesc } = matched?.groups;

        // url 开始
        const imageUrl = await findUrl(_imageUrl);
        // console.log(`${_imageName} <--> ${imageUrl}`);
        if (!imageUrl) return console.log(`imageUrl 未找到`);
        console.log(`匹配到url --> ${imageUrl}`);
        // url 结束

        // 图片 type 开始
        var imageType = _imageType;
        if (statusData.TYPE == "studentEvaluation") {
            try {
                const _ = await studentEvaluation(imageType);
                if (_.fuzzy) return console.log("模糊搜索结果:", _.fuzzy.map(v => v.name).join());
                imageType = _.type;
                // debugger;
                // ret.type = _.type; // fuzzy或者角色的pathName
                // ret.nameDesc = _.desc || ret.nameDesc; // 对于type的描述, 精准匹配时为角色名称
                // ret.fuzzy = _.fuzzy; // 模糊匹配结果

            } catch (err) {
                console.error(err);
                return;
            }
        } else {
            const _t = Object.entries(handbookMatches.types).find(([_, v]) => v.test(imageType));
            imageType = (_t || [])[0] || imageType;
            // debugger;

            if (!matchNames[statusData.TYPE] || !matchNames[statusData.TYPE]?.has?.includes(imageType as any)) {
                debugger; return console.log(`${statusData.TYPE} 中未找到类型 ${imageType} ，仅支持 ${matchNames[statusData.TYPE].has}`);
            } else if (!Object.hasOwnProperty.call(serverMap, imageType)) {
                debugger; return console.log(`未找到类型 ${imageType} ，允许类型： ${Object.keys(serverMap)}`);
            }
            // debugger;
        }
        // 图片 type 结束



        const imageName = statusData.TYPE;
        const imageKey = `${imageName}/${imageType}.png`;
        console.log(`imageKey: ${imageKey}`);



        // 预览原图
        if (fs.existsSync(`${config.handbookRoot}/${imageKey}`)) {
            const _lastestImage = await getLastestImage(imageName, imageType);
            console.log("旧数据:", stringifyFormat(_lastestImage));

            execSync(`fim ${config.handbookRoot}/${imageKey} &`, { stdio: 'inherit' });
            await sleep(3 * 1000);
        }
        // debugger;


        await redis.hSet("handbook:cache", `${imageName}:${imageType}`, new Date().getTime());
        // await redis.hSet("handbook:info", `${imageName}:${imageType}`, imageDesc || "");
        // await redis.hSet("handbook:infoUrl", `${imageName}:${imageType}`, imageTurnUrl || "");
        const imageBuff = await fetch(imageUrl.startsWith("http") ? imageUrl : `https://${imageUrl}`)
            .then(res => res.buffer());
        fs.writeFileSync(`${config.handbookRoot}/${imageKey}`, imageBuff);
        cosPutObject({ Key: `handbook/${imageKey}`, Body: imageBuff });

        const lastestImage = await getLastestImage(imageName, imageType);
        // if (devEnv) log.debug(lastestImage);

        // 预览最终输出图
        execSync(`fim ${config.handbookRoot}/${imageKey} &`, { stdio: 'inherit' });
        console.log(`${imageKey} refetch ok`);
        console.log("\n\n");



    }




    // console.log(`matched: ${hbMatchedType} ${hbMatchedName}`);
    // const imageType = hbMatchedType;


    // // 存入本地与数据库
    // await redis.hSet("handbook:cache", `${imageName}:${imageType}`, new Date().getTime());
    // await redis.hSet("handbook:info", `${imageName}:${imageType}`, "");
    // await redis.hSet("handbook:infoUrl", `${imageName}:${imageType}`, "");
    // await fetch(imageUrl.startsWith("http") ? imageUrl : `https://${imageUrl}`)
    //     .then(res => res.buffer())
    //     .then(buff => fs.writeFileSync(`${config.handbookRoot}/${imageName}/${imageType}.png`, buff));
    // console.log("set ok");


    // // 预热图片
    // const lastestImage = await (await import("../src/plugins/handbook")).getLastestImage(imageName, imageType);
    // console.debug(lastestImage);
    // await fetch(lastestImage.url, {
    //     headers: { "user-agent": "QQShareProxy" },
    //     timeout: 60 * 1000,
    // }).then(res => res.buffer()).then(buff => console.log(`${imageName} ${imageType}\nsize: ${(buff.length / 1024).toFixed(2)}K`)).catch(err => console.error(err));
    // // 


}




async function findUrl(input: string, imageId = 0) {
    var imageUrl = /(?<imageUrl>(https:\/\/)?.+\.(png|jpg|jpeg))/.exec(input)?.groups?.imageUrl;
    if (imageUrl) return imageUrl;

    const dynamicId = /(arona\.schale\.top\/turn)|(t\.bilibili\.com\/(?<dynamicId>\d+))/.exec(input)?.groups?.dynamicId;
    if (!dynamicId) return;

    debugger;

    try {
        // imageUrl = await fetch(url.startsWith("https://") ? url : "https://" + url).then(res => {
        //     // log.debug(res.url);
        //     // const dynamicId = /https:\/\/t.bilibili.com\/(\d+)/.exec(res.url);
        //     if (dynamicId) return fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${dynamicId[1]}`, {
        //         headers: {
        //             "User-Agent": "Mozilla/5.0",// userAgent,
        //             "Cookie": "SESSDATA=feilongproject.com;", //cookies, //`SESSDATA=feilongproject.com;${cookies}`,
        //         }
        //     });
        //     else throw `未知的url: ${res.url}`;
        // }).then(res => res.json()).then((data) => {
        //     const draw = data.data.item.modules.module_dynamic.major.draw;
        //     // log.debug(draw);
        //     if (!draw) throw `未找到指定动态中的图片`;
        //     if (Number(imageId) <= 0 || Number(imageId) > draw.items.length) throw `查询图片 id:${imageId} 超出范围，范围: 1 - ${draw.items.length}`;
        //     return draw.items[Number(imageId) - 1 || 0].src;
        // });
    } catch (err) {
        console.error(err);
        return; // msg.sendMsgEx({ content: `查找图片时出现错误\n` + JSON.stringify(err).replaceAll(".", ",") });
    }


    return imageUrl;
}


function setPrompt() {
    rl.setPrompt(`${status} ${statusData.TYPE ? `(${statusData.TYPE}) ` : ""}${statusData.URL ? `${statusData.URL} ` : ""}> `);
    rl.prompt();
}



(async () => {
    await global.redis.connect().then(() => {
        console.log(`初始化: redis 数据库连接成功`);
    }).catch(err => {
        console.error(`初始化: redis 数据库连接失败，正在退出程序\n${err}`);
        process.exit();
    });
    console.log(`初始化: 正在连接腾讯 COS`);
    global.cos = new COS(config.cos);

    setPrompt();
})();


rl.on("line", input => {
    if (!input) return setPrompt();

    try {
        execSync("ps -a|grep fim").toString().split("\n")
            .map(v => v.split(" ")[0])
            .filter(v => v)
            .map(pid => execSync(`kill ${pid}`));
    } catch (_) { }


    if (input == Status.TYPE || input == Status.URL) {
        status = input;
        console.log(`status已设置为 ${status}`);
        return setPrompt();
    }

    main(input)
        .then(() => setPrompt())
        .catch(err => { console.error(err); setPrompt(); });

});