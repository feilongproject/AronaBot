import fs from "fs";
import sharp from "sharp";
import fetch from "node-fetch";
import format from "date-format";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";
import { reloadStudentInfo, settingUserConfig } from "../libs/common";
import config from '../../config/config';

const starString = ["☆☆☆", "★☆☆", "★★☆", "★★★"];
const nameToId = { jp: 0, global: 1 };
var key: keyof typeof nameToId;

const gachaPoolInfo: GachaPoolInfo = {
    global: { common: { 1: [], 2: [], 3: [] }, pickup: { characters: [], start: 0, end: 0 } },
    jp: { common: { 1: [], 2: [], 3: [] }, pickup: { characters: [], start: 0, end: 0 } },
};


gachaReload("local").then(d => {
    return log.info(`初始化抽卡数据加载完毕: ${d}`);
}).catch(async err => {
    log.error(err);
    return global.client.directMessageApi.postDirectMessage((await global.redis.hGet(`directUid->Gid`, adminId[0]))!, {
        content: `初始化抽卡数据过程中出错: ${err}`,
    });
});


export async function gachaString(msg: IMessageGUILD) {
    const setting = await settingUserConfig(msg.author.id, "GET", ["server"]);
    const o = cTime(setting.server == "jp" ? "jp" : "global", /十/.test(msg.content) ? 10 : 1);
    var sendStr: string[] = [
        `<@${msg.author.id}> (${setting.server == "jp" ? "日服" : "国际服"}卡池)`,
        /十/.test(msg.content) ? `————————十连结果————————` : `————————单抽结果————————`
    ];
    for (const value of o) sendStr.push(`(${starString[value.star]})(${value.pathName})${value.name}`);
    return msg.sendMsgExRef({ content: sendStr.join(`\n`), });
}

export async function gachaImage(msg: IMessageGUILD) {
    const setting = await settingUserConfig(msg.author.id, "GET", ["server", "analyzeHide"]);
    const o = cTime(setting.server == "jp" ? "jp" : "global", 10, adminId.includes(msg.author.id) ? Number(msg.content.match(/\d$/)) as 1 | 2 | 3 : undefined);
    const analyze = setting.analyzeHide == "true" ? null : await analyzeRandData(setting.server == "jp" ? "jp" : "global", msg.author.id, o);
    const imageName = await buildImage(o);
    if (devEnv) log.debug(imageName);
    return msg.sendMarkdown({
        templateId: "102024160_1694664174",
        params: Object.assign({
            at_user: `<@${msg.author.id}> (${setting.server == "jp" ? "日服" : "国际服"}卡池)\r`,
            link1: "\u200b](https://ip.arona.schale.top/turn/",
            img1: `img #1700px #980px](https://ip.arona.schale.top/p/gacha/${imageName}`,
            img2: "img #-1px #1px](  ",
        }, analyze ? {
            desc1: `${analyze?.today_gacha}`,
            desc2: `\r${analyze?.total_gacha}`,
            desc3: `\r${analyze?.gacha_analyze}`,
        } : {} as any),
        keyboardId: "102024160_1692938526",
        // markdown 部分

        content: `<@${msg.author.id}> (${setting.server == "jp" ? "日服" : "国际服"}卡池)` +
            `\n${analyze?.today_gacha}` +
            `\n${analyze?.total_gacha}` +
            `\n${analyze?.gacha_analyze}`,
        imageUrl: `https://ip.arona.schale.top/p/gacha/${imageName}`,
        // fallback 部分

    }).catch(err => {
        log.error(err);
        return msg.sendMsgExRef({
            content: `发送消息时出现了错误 <@${adminId[0]}>`
                + `\nimageName: ${imageName?.replaceAll(".", ",")}`
                + `\n${JSON.stringify(err).replaceAll(".", ",")}`,
        });
    });
}

function cTime(server: "global" | "jp", times: 1 | 10, testStar?: 1 | 2 | 3): GachaPools {
    var ret: GachaPools = [];
    var must = true;
    function startRand(type: "pickup" | "common", star: 1 | 2 | 3): GachaPool {
        if (star != 1) must = false;
        const rNum = Math.random() * 1000000;
        const _pools = type == "common" ? gachaPoolInfo[server][type][star] : gachaPoolInfo[server][type].characters;
        const _poolsInfo = studentInfo[_pools[Math.floor(rNum % _pools.length)]];
        return { ..._poolsInfo, star, name: _poolsInfo.name[0] };
    }

    for (var i = 1; i <= times; i++) {
        //三星角色（彩色）的抽取概率为0.7up 2.3常驻，二星角色（金色）为18，一星角色（灰色）为79
        var rNum = Math.random() * 100;
        if (testStar == 3) rNum = rNum % 3;
        if (i == 10 && must) rNum = rNum % 21;
        if (rNum <= 0.05) ret.push({ name: "彩奈", pathName: "Arona", devName: "Arona", star: 3, custom: "NPC_Portrait_Arona.png" });//彩蛋
        else if (rNum <= 0.7 && gachaPoolInfo[server].pickup.characters.length > 0) ret.push(startRand("pickup", 3));
        else if (rNum <= 3) ret.push(startRand("common", 3));
        else if (rNum <= 3 + 18) ret.push(startRand("common", 2));
        else ret.push(startRand("common", 1));
    }
    return ret;
}

async function buildImage(characterNames: GachaPools): Promise<string | null> {
    const starPos = [0, 90, 50, 30];
    if (characterNames.length != 10) return null;

    botStatus.imageRenderNum++;
    const outName = `${new Date().getTime()}.png`;
    var tmpOutPath = `${config.imagesOut}/${outName}`;
    var files: { input: string, top: number, left: number, }[] = [];
    for (const [i, value] of characterNames.entries()) {
        var x = ((i) % 5);
        var y = parseInt(`${i / 5}`.slice(0, 1));
        x *= 300, x += 120;
        y *= 350, y += 180;
        files.push({ input: config.images.gachaMask[value.star], top: y - 10, left: x - 4, });//character bg
        if (value.custom) files.push({ input: `${config.images.characters}/${value.custom}`, top: y, left: x, });//custom avatar
        else files.push({ input: `${config.images.characters}/Student_Portrait_${value.devName}.png`, top: y, left: x, });//character avatar
        files.push({ input: config.images.starBg, top: y + 190, left: x - 10, });//star bg
        for (let i = 0; i < value.star; i++) //stars
            files.push({ input: `${config.images.star}`, top: y + 195, left: x + starPos[value.star] + i * 60, });
    }
    return sharp(config.images.mainBg)
        .composite(files)
        .png({ compressionLevel: 6, quality: 5, })
        .toFile(tmpOutPath).then(() => {
            return outName;
        });
}

async function analyzeRandData(server: "global" | "jp", uid: string, data: GachaPools) {

    const nowDay = (new Date()).setHours(0, 0, 0, 0) + 1000 * 60 * 60 * 24;
    const gachaData: {
        all: string[] | number[],
        today: string[] | number[],
    } = {
        all: (await redis.hGet(`data:gacha:all`, `${uid}:${server}`) || "0,0,0,0").split(","),
        today: (await redis.hGet(`data:gacha:${nowDay}`, `${uid}:${server}`) || "0,0,0,0").split(","),
    }
    for (const o of data) {
        gachaData.all[o.star] = Number(gachaData.all[o.star]) + 1;
        gachaData.today[o.star] = Number(gachaData.today[o.star]) + 1;
    }
    await redis.hSet(`data:gacha:all`, `${uid}:${server}`, gachaData.all.join());
    await redis.hSet(`data:gacha:${nowDay}`, `${uid}:${server}`, gachaData.today.join());
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

export async function reloadGachaData(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    const type = /^抽卡数据(网络|本地)重加载$/.exec(msg.content)![1];
    return gachaReload(type == "网络" ? "net" : "local")
        .then(r => msg.sendMsgExRef({ content: `已从${type}重加载资源并保存\n${r}\n${analyzeLocalDate().join("\n")}` }))
        .catch(err => {
            log.error(err);
            return msg.sendMsgExRef({ content: `${type}获取资源错误: ${err}` });
        });
}

function analyzeLocalDate() {
    const sendStr: string[] = [];
    for (key in nameToId) {
        sendStr.push("==================", `${key}服`);

        const common = gachaPoolInfo[key].common as Record<number, number[]>;
        for (const star in common) {
            const _all: string[] = [];
            for (const _ of common[star]) _all.push(studentInfo[_].name[0]);
            sendStr.push(`> ${star}星: ${_all.join(" | ")}`);
        }

        const pickup = gachaPoolInfo[key].pickup;
        if (pickup.characters.length) {
            const _all: string[] = [];
            for (const _ of pickup.characters) _all.push(studentInfo[_].name[0]);
            sendStr.push(
                `> pickup: ${_all.join()}`,
                `> pickup开始时间: ${format.asString(new Date(pickup.start * 1000))}`,
                `> pickup结束时间: ${format.asString(new Date(pickup.end * 1000))}`,
            );
        } else sendStr.push(`> 无pickup`);
    }
    return sendStr;
}

async function gachaReload(type: "net" | "local") {
    if (type == "net") return reloadStudentInfo(type).then(async r => {
        const _gachaPoolInfo: GachaPoolInfo = {
            global: { common: { 1: [], 2: [], 3: [] }, pickup: { characters: [], start: 0, end: 0 } },
            jp: { common: { 1: [], 2: [], 3: [] }, pickup: { characters: [], start: 0, end: 0 } },
        };

        for (const id in studentInfo) {
            const d = studentInfo[id];
            for (key in nameToId)
                if (d.releaseStatus[nameToId[key]] && !d.limitedType) _gachaPoolInfo[key].common[d.star].push(Number(id));
        }// common

        const schaleDBConfig: SchaleDB.Root = await fetch("https://raw.gh.schale.top/lonqie/SchaleDB/main/data/config.min.json").then(res => res.json()).catch(err => log.error(err));
        if (!schaleDBConfig) throw `can't fetch json:common`;

        const nowTime = new Date().getTime() / 1000;
        for (key in nameToId) {
            const regions = schaleDBConfig.Regions.find(v => v.Name.toLowerCase() == key);
            if (!regions) throw `not found regions: ${key}`;
            for (const _nowPick of regions.CurrentGacha)
                if (_nowPick.start < nowTime && nowTime < _nowPick.end) {
                    for (const pick of _nowPick.characters)
                        if (studentInfo[pick].star == 3) _gachaPoolInfo[key].pickup.characters.push(pick);
                    _gachaPoolInfo[key].pickup.start = _nowPick.start;
                    _gachaPoolInfo[key].pickup.end = _nowPick.end;
                }
        }

        gachaPoolInfo.global = _gachaPoolInfo.global;
        gachaPoolInfo.jp = _gachaPoolInfo.jp;
        fs.writeFileSync(config.gachaPoolInfo, JSON.stringify(_gachaPoolInfo));
        return `net | ${r}`;
    });
    else {
        if (fs.existsSync(config.gachaPoolInfo)) {
            const _gachaPoolInfo: GachaPoolInfo = JSON.parse(fs.readFileSync(config.gachaPoolInfo).toString());
            gachaPoolInfo.global = _gachaPoolInfo.global;
            gachaPoolInfo.jp = _gachaPoolInfo.jp;
            return "local | ok";
        } else throw "local not exists";
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
}

type GachaPools = GachaPool[];
interface GachaPool {
    star: number;
    name: string;
    devName: string;
    pathName: string;
    custom?: string;
}

namespace SchaleDB {
    export interface Root {
        links: Link[];
        build: number;
        Regions: Region[];
        Changelog: Changelog[];
        TypeEffectiveness: TypeEffectiveness;
        GachaGroups: GachaGroup[];
    }

    interface Link {
        section: string;
        content: Content[];
    }

    interface Content {
        title: string;
        description: string;
        url: string;
        author: string;
    }

    export interface Region {
        Name: string;
        StudentMaxLevel: number;
        WeaponMaxLevel: number;
        BondMaxLevel: number;
        EquipmentMaxLevel: number[];
        CampaignMax: number;
        CampaignExtra: boolean;
        Events: number[];
        Event701Max: number[];
        ChaserMax: number;
        BloodMax: number;
        FindGiftMax: number;
        SchoolDungeonMax: number;
        FurnitureSetMax: number;
        FurnitureTemplateMax: number;
        CurrentGacha: CurrentGacha[];
        CurrentEvents: any[];
        CurrentRaid: CurrentRaid[];
    }

    export interface CurrentGacha {
        characters: number[];
        start: number;
        end: number;
    }

    export interface CurrentRaid {
        type: string;
        raid: number;
        terrain?: string;
        start: number;
        end: number;
    }

    interface Changelog {
        date: string;
        contents: string[];
    }

    interface TypeEffectiveness {
        Normal: Normal;
        Explosion: Explosion;
        Pierce: Pierce;
        Mystic: Mystic;
        Sonic: Sonic;
    }

    interface Normal {
        LightArmor: number;
        HeavyArmor: number;
        Unarmed: number;
        Structure: number;
        ElasticArmor: number;
        Normal: number;
    }

    interface Explosion {
        LightArmor: number;
        HeavyArmor: number;
        Unarmed: number;
        Structure: number;
        ElasticArmor: number;
        Normal: number;
    }

    interface Pierce {
        LightArmor: number;
        HeavyArmor: number;
        Unarmed: number;
        Structure: number;
        ElasticArmor: number;
        Normal: number;
    }

    interface Mystic {
        LightArmor: number;
        HeavyArmor: number;
        Unarmed: number;
        Structure: number;
        ElasticArmor: number;
        Normal: number;
    }

    interface Sonic {
        LightArmor: number;
        HeavyArmor: number;
        Unarmed: number;
        Structure: number;
        ElasticArmor: number;
        Normal: number;
    }

    export interface GachaGroup {
        Id: number;
        ItemList: number[][];
    }
}
