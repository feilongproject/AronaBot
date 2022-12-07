import sharp, { bool } from "sharp";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";
import config from '../../config/config.json';
import { existsSync, readFileSync, writeFileSync } from "fs";
import fetch from "node-fetch";

const maxTime = 30;
const starString = ["☆☆☆", "★☆☆", "★★☆", "★★★"];
var studentInfo: { [key: string]: { name: string; pathName: string; devName: string; } } = {};
var gachaPoolInfo: GachaPoolInfo = {
    global: { common: { 1: [], 2: [], 3: [] }, pickup: { characters: [], start: 0, end: 0 } },
    jp: { common: { 1: [], 2: [], 3: [] }, pickup: { characters: [], start: 0, end: 0 } },
};
reload("local", true).then(d => {
    return log.info("初始化抽卡数据加载完毕");
}).catch(async err => {
    log.error(err);
    return global.client.directMessageApi.postDirectMessage((await global.redis.hGet(`directUid->Gid`, adminId[0]))!, {
        content: `初始化抽卡数据过程中出错: ${err}`,
    });
});


export async function gachaString(msg: IMessageGUILD) {
    const setting = await settingConfig(msg.author.id, "GET");
    const o = cTime(setting.poolType, /十/.test(msg.content) ? 10 : 1);
    var sendStr: string[] = [
        `<@${msg.author.id}> (${setting.poolType == "global" ? "国际服" : "日服"}卡池)`,
        /十/.test(msg.content) ? `————————十连结果————————` : `————————单抽结果————————`
    ];
    for (const value of o) sendStr.push(`(${starString[value.star]})(${value.pathName})${value.name}`);
    return msg.sendMsgExRef({ content: sendStr.join(`\n`), }).then(() => {
        //return redis.setEx(`gachaLimitTTL:${msg.author.id}`, maxTime, "1");
    });
}

export async function gachaImage(msg: IMessageGUILD) {
    if (await hasCd(msg)) return;

    return redis.setEx(`gachaLimitTTL:${msg.author.id}`, maxTime, "1").then(async () => {
        const setting = await settingConfig(msg.author.id, "GET");
        const o = cTime(setting.poolType, 10, adminId.includes(msg.author.id) ? Number(msg.content.match(/\d$/)) as 1 | 2 | 3 : undefined);
        const analyze = setting.hide ? null : await analyzeRandData(setting.poolType, msg.author.id, o);
        const imageName = await buildImage(o);
        return msg.sendMarkdown("102024160_1668504873", {
            at_user: `<@${msg.author.id}> (${setting.poolType == "global" ? "国际服" : "日服"}卡池)`,
            ...analyze,
            img_size: "img #1700px #980px",
            img_url: `https://res.feilongproject.com/gachaPic/${imageName}`,
        }, "102024160_1669972662");
    }).catch(err => {
        log.error(err,);
        msg.sendMsgExRef({ content: err.toString().replaceAll(".", " .") });
    })
}

async function hasCd(msg: IMessageGUILD) {
    const ttl = await redis.pTTL(`gachaLimitTTL:${msg.author.id}`);
    const payTTL = parseInt(await redis.hGet(`pay:gachaLimitTTL`, `${msg.author.id}`) || "0");
    if ((ttl - payTTL > 0) && !adminId.includes(msg.author.id))
        return msg.sendMsgExRef({
            content: `请求时间过短，还有${(ttl - payTTL) / 1000}s冷却完毕` +
                `\n(因为当前服务器性能不足，所以设置冷却cd，赞助以购买一个更好的服务器，也可以获得更少的冷却时间！)` +
                `\n（当拥有更高配置的服务器时会取消冷却cd限制！）` +
                `\n（同时为开发者的女装计划助力！）`
        });
    return null;
}

function cTime(poolType: "global" | "jp", times: 1 | 10, testStar?: 1 | 2 | 3): GachaPools {

    var ret: GachaPools = [];
    var must = true;

    function startRand(type: "pickup" | "common", star: 1 | 2 | 3): GachaPool {
        if (star != 1) must = false;
        const rNum = Math.random() * 1000000;
        if (type == "common") {
            const _pools = gachaPoolInfo[poolType][type][star];
            return { ...studentInfo[_pools[Math.floor(rNum % _pools.length)]], star };
        } else {
            const _pools = gachaPoolInfo[poolType][type].characters;
            return { ...studentInfo[_pools[Math.floor(rNum % _pools.length)]], star };
        }
    }

    for (var i = 1; i <= times; i++) {
        //三星角色（彩色）的抽取概率为0.7up 2.3常驻，二星角色（金色）为18，一星角色（灰色）为79
        var rNum = Math.round(Math.random() * 100);
        if (testStar == 3) rNum = rNum % 3;
        if (i == 10 && must) rNum = rNum % 21;
        if (Math.round(Math.random() * 100) <= 0.05) ret.push({ name: "彩奈", pathName: "Arona", devName: "Arona", star: 3, custom: "NPC_Portrait_Arona.png" });//彩蛋
        else if (rNum <= 0.7) ret.push(startRand("pickup", 3));
        else if (rNum <= 3) ret.push(startRand("common", 3));
        else if (rNum <= 3 + 18) ret.push(startRand("common", 2));
        else ret.push(startRand("common", 1));
    }
    return ret;
}

async function buildImage(characterNames: GachaPools): Promise<string | null> {

    if (characterNames.length == 10) {
        const outName = `${new Date().getTime()}.png`;
        var tmpOutPath = `${config.picPath.out}/${outName}`;
        var files: { input: string, top: number, left: number, }[] = [];

        for (const [i, value] of characterNames.entries()) {
            var x = ((i) % 5);
            var y = parseInt(`${i / 5}`.slice(0, 1));
            x *= 300, x += 120;
            y *= 350, y += 180;
            files.push({ input: `${config.picPath.starBg}`, top: y + 190, left: x - 10, });//star bg
            files.push({ input: `${config.picPath.mask[value.star]}`, top: y - 10, left: x - 4, });//character bg
            if (value.custom) files.push({ input: `${config.picPath.characters}/${value.custom}`, top: y, left: x, });//custom avatar
            else files.push({ input: `${config.picPath.characters}/Student_Portrait_${value.devName}.png`, top: y, left: x, });//character avatar
            for (let i = 0; i < value.star; i++) //stars
                files.push({ input: `${config.picPath.star}`, top: y + 210, left: x + 30 + i * 60, });
        }

        return sharp(config.picPath.mainBg)
            .composite(files)
            .png({ compressionLevel: 6, quality: 5, })
            .toFile(tmpOutPath).then(() => {
                return outName;
            });
    }
    return null;
}

async function analyzeRandData(poolType: "global" | "jp", uid: string, data: GachaPools) {

    const nowDay = (new Date()).setHours(0, 0, 0, 0) + 1000 * 60 * 60 * 24;
    const gachaData: {
        all: string[] | number[],
        today: string[] | number[],
    } = {
        all: (await redis.hGet(`data:gacha:all`, `${uid}:${poolType}`) || "0,0,0,0").split(","),
        today: (await redis.hGet(`data:gacha:${nowDay}`, `${uid}:${poolType}`) || "0,0,0,0").split(","),
    }
    for (const o of data) {
        gachaData.all[o.star] = Number(gachaData.all[o.star]) + 1;
        gachaData.today[o.star] = Number(gachaData.today[o.star]) + 1;
    }
    await redis.hSet(`data:gacha:all`, `${uid}:${poolType}`, gachaData.all.join());
    await redis.hSet(`data:gacha:${nowDay}`, `${uid}:${poolType}`, gachaData.today.join());
    await redis.expireAt(`data:gacha:${nowDay}`, nowDay / 1000);

    const _t: number[] = [];
    const _a: number[] = [];
    for (const __t of gachaData.today) _t.push(Number(__t));
    for (const __a of gachaData.all) _a.push(Number(__a));

    return {
        today_gacha: `今日${_t[1] + _t[2] + _t[3]}发，共有一星${_t[1]}个，二星${_t[2]}个，三星${_t[3]}个`,
        total_gacha: `累计${_a[1] + _a[2] + _a[3]}发，共有一星${_a[1]}个，二星${_a[2]}个，三星${_a[3]}个`,
        gacha_analyze: `今日出货概率${((_t[3] / (_t[1] + _t[2] + _t[3])) * 100).toFixed(2)}%，` +
            `累计出货概率${((_a[3] / (_a[1] + _a[2] + _a[3])) * 100).toFixed(2)}%`
    }
}

export async function reloadData(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    if (msg.content.includes("网络")) {
        await reload("net").then(() => {
            return msg.sendMsgExRef({ content: `已从网络获取资源并保存\n${JSON.stringify(gachaPoolInfo)}` });
        }).catch(err => {
            log.error(err);
            return msg.sendMsgExRef({ content: `网络获取资源错误: ${err}` });
        })
    } else if (msg.content.includes("本地")) {
        return reload("local").then(() => {
            return msg.sendMsgExRef({ content: `已从文件中重加载` });
        }).catch(err => {
            log.error(err);
            return msg.sendMsgExRef({ content: `从本地加载文件错误: ${err}` });
        });
    }
}

async function reload(type: "net" | "local", init?: boolean): Promise<string> {
    if (type == "net") {
        const common = await fetch("https://ghproxy.com/https://raw.githubusercontent.com/lonqie/SchaleDB/main/data/common.json").then(res => {
            return res.json();
        }).catch(err => {
            log.error(err);
        });
        if (!common) throw `can't fetch json:common`;

        const students: {
            Id: number;
            Name: string;
            DevName: string;
            PathName: string;
            StarGrade: 1 | 2 | 3;
            IsLimited: number;
            IsReleased: boolean[];
        }[] = await fetch("https://ghproxy.com/https://raw.githubusercontent.com/lonqie/SchaleDB/main/data/cn/students.json").then(res => {
            return res.json();
        }).catch(err => {
            log.error(err);
        });
        if (!students) throw `can't fetch json:students`;

        for (const d of students) {
            if (d.IsLimited) continue;
            const devName = d.DevName[0].toLocaleUpperCase() + d.DevName.slice(1);
            if (!existsSync(`${config.picPath.characters}/Student_Portrait_${devName}.png`))
                throw `not found png file in local: Student_Portrait_${devName}`;
            if (d.IsReleased[0]) gachaPoolInfo.jp.common[d.StarGrade].push(d.Id);
            if (d.IsReleased[1]) gachaPoolInfo.global.common[d.StarGrade].push(d.Id);
            studentInfo[d.Id] = { name: d.Name, pathName: d.PathName, devName, };
        }
        gachaPoolInfo.jp.pickup = common.regions[0].current_gacha[0];
        gachaPoolInfo.global.pickup = common.regions[1].current_gacha[0];
        writeFileSync(config.studentInfo, JSON.stringify(studentInfo));
        writeFileSync(config.gachaPoolInfo, JSON.stringify(gachaPoolInfo));
        if (init) throw "not found studentInfo file or gachaPoolInfo file, but load form net";
    } else if (type == "local") {
        if (existsSync(config.studentInfo) && existsSync(config.gachaPoolInfo)) {
            studentInfo = JSON.parse(readFileSync(config.studentInfo).toString());
            gachaPoolInfo = JSON.parse(readFileSync(config.gachaPoolInfo).toString());
            if (init) log.info("成功从本地重加载");
        } else {
            return reload("net", init);
        }
    }
    return "ok";
}

/**
 * key:   setting:gacha
 * field: uid
 * value: 1(init),0(show/hide),0(continue analyze),0(global or jp)
 * @param aid author id
 * @param types GET or SET
 * @returns GachaSetting
 */
async function settingConfig(aid: string, types: "GET" | "SET", set?: Partial<GachaSetting>): Promise<GachaSetting> {
    //log.debug(types, set);
    var setting: GachaSetting;
    if (set && set.init != undefined && set.hide != undefined && set.poolType != undefined) {//ASET
        setting = set as GachaSetting;
    } else {
        setting = await redis.hGet("setting:gacha", aid).then(setting => {
            const splitConfig = (setting || "false,false,global").split(",");
            const config: GachaSetting = {
                init: splitConfig[0] == "false" ? false : true,
                hide: splitConfig[1] == "false" ? false : true,
                poolType: splitConfig[2] == "global" ? "global" : "jp",
            }
            if (types == "GET") return config;
            else return Object.assign(config, set);
        }).catch(err => {
            log.error(err);
            return { init: false, hide: false, poolType: "global" };
        });
    }
    if (types == "GET") return setting;

    const splitConfig = [];
    let key: keyof GachaSetting;
    for (key in setting) splitConfig.push(setting[key]);
    return redis.hSet(`setting:gacha`, aid, splitConfig.join()).then(() => {
        return setting;
    }).catch(err => {
        log.error(err);
        return { init: true, hide: false, poolType: "global" };
    });
}

export async function gachaSetting(msg: IMessageGUILD) {
    const nowDay = (new Date()).setHours(0, 0, 0, 0) + 1000 * 60 * 60 * 24;
    if (/重置/.test(msg.content)) {
        return settingConfig(msg.author.id, "SET", { init: true, hide: false, poolType: "global" }).then(() => {
            return redis.hSet(`data:gacha:all`, [
                [`${msg.author.id}:global`, "0,0,0,0"],
                [`${msg.author.id}:jp`, "0,0,0,0"]
            ]);
        }).then(() => {
            return redis.hSet(`data:gacha:${nowDay}`, [
                [`${msg.author.id}:global`, "0,0,0,0"],
                [`${msg.author.id}:jp`, "0,0,0,0"]
            ]);
        }).then(() => {
            return msg.sendMsgExRef({
                content: `已重置卡池选择为国际服` +
                    `\n已重置所有统计为空` +
                    `\n已重置统计信息为显示状态` +
                    `\n（注: 这是一个不可撤回的操作！）`,
            })
        });
    }

    if (await redis.hExists(`setting:gacha`, `${msg.author.id}`)) {
        if (/清空(今日|全部)/.test(msg.content)) {
            const type = /今日/.test(msg.content) ? "T" : "A";
            if (type == "T") return redis.hSet(`data:gacha:all`, [
                [`${msg.author.id}:global`, "0,0,0,0"],
                [`${msg.author.id}:jp`, "0,0,0,0"]
            ]);
            else return redis.hSet(`data:gacha:${nowDay}`, [
                [`${msg.author.id}:global`, "0,0,0,0"],
                [`${msg.author.id}:jp`, "0,0,0,0"]
            ]);
        } else if (/更改显示/.test(msg.content)) {
            const status = await settingConfig(msg.author.id, "GET");
            if (!status.init) {
                return msg.sendMsgExRef({ content: `未找到用户设置，请@bot后输入"/抽卡设置 重置"开始初始化设置` });
            } else {
                status.hide = !status.hide;
                return settingConfig(msg.author.id, "SET", status).then(() => {
                    return msg.sendMsgExRef({ content: `已更改统计信息为: ${status.hide ? "隐藏" : "显示"}` });
                });
            }
        } else if (/更(改|换)卡池/.test(msg.content)) {
            const status = await settingConfig(msg.author.id, "GET");
            if (!status.init) {
                return msg.sendMsgExRef({ content: `未找到用户设置，请@bot后输入"/抽卡设置 重置"开始初始化设置` });
            } else {
                status.poolType = status.poolType == "global" ? "jp" : "global";
                return settingConfig(msg.author.id, "SET", status).then(() => {
                    return msg.sendMsgExRef({ content: `已更改卡池为: ${status.poolType == "global" ? "国际服" : "日服"}卡池` });
                });
            }
        } else if (/帮助/.test(msg.content)) {
            const status = await settingConfig(msg.author.id, "GET");
            return msg.sendMsgExRef({
                content: `抽卡设置 - 帮助界面` +
                    `\n========================` +
                    `\n指令：/抽卡设置 更改显示` +
                    `\n介绍：更改抽卡统计信息显示为当前相反值（默认显示）` +
                    `\n\n指令：/抽卡设置 更改卡池` +
                    `\n介绍：更改当前卡池为另一卡池（当前为${status.poolType == "global" ? "国际服" : "日服"}卡池）` +
                    `\n\n指令：/抽卡设置 清空今日` +
                    `\n介绍：清空今日抽卡统计信息` +
                    `\n\n指令：/抽卡设置 清空全部` +
                    `\n介绍：清空全部抽卡统计信息` +
                    `\n\n指令：/抽卡设置 重置` +
                    `\n介绍：重置所有卡池设置到默认（卡池选择、统计信息等）`,
            });
        } else {
            return msg.sendMsgExRef({ content: `未知抽卡设置选项，使用"/抽卡设置 帮助"获取指令列表` });
        }
    } else {
        return msg.sendMsgExRef({
            content: `未找到用户设置，请@bot后输入"/抽卡设置 重置"开始初始化设置` +
                `\n（如果之后要恢复默认也可使用该命令）`
        });
    }
}


interface GachaPoolInfo {
    global: GachaPoolInfoServer;
    jp: GachaPoolInfoServer;
}
interface GachaPoolInfoServer {
    common: { 1: number[]; 2: number[]; 3: number[]; };
    pickup: GachaPoolInfoPickup;
}
interface GachaPoolInfoPickup {
    characters: number[];
    start: number;
    end: number;
};

interface GachaSetting {
    init: boolean;
    hide: boolean;
    poolType: "global" | "jp";
}

type GachaPools = GachaPool[];
interface GachaPool {
    star: number;
    name: string;
    devName: string;
    pathName: string;
    custom?: string;
};