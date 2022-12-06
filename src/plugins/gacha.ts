import sharp from "sharp";
import { IMessageGUILD } from "../libs/IMessageEx";
import config from '../../config/config.json';
import choicesList from "../../data/choices.json";

var maxTime = 30;

export async function gachaString(msg: IMessageGUILD) {

    const o = cTime(10);
    var sendStr: string[] = [];
    if (/十/.test(msg.content)) {
        sendStr.push(`————————十连结果————————`);
        for (const value of o) sendStr.push(`(${choicesList.starString[value.star]})(${value.name.source})${value.name.chineseName}`);
    } else {
        sendStr.push(`————————单抽结果————————`);
        sendStr.push(`(${choicesList.starString[o[0].star]})(${o[0].name.source})${o[0].name.chineseName}`);
    }
    return msg.sendMsgExRef({ content: sendStr.join(`\n`), }).then(() => {
        //return redis.setEx(`gachaLimitTTL:${msg.author.id}`, maxTime, "1");
    });
}

export async function gachaImage(msg: IMessageGUILD) {
    if (await hasCd(msg)) return;

    return redis.setEx(`gachaLimitTTL:${msg.author.id}`, maxTime, "1").then(async () => {
        const o = cTime(10, adminId.includes(msg.author.id) ? Number(msg.content.match(/\d$/)) as 1 | 2 | 3 : undefined);
        const analyze = await analyzeRandData(msg.author.id, o);
        const imageName = await buildImage(o);
        return msg.sendMarkdown("102024160_1668504873", {
            at_user: `<@${msg.author.id}>`,
            ...analyze,
            img_size: "img #1700px #980px",
            img_url: `https://res.feilongproject.com/gachaPic/${imageName}`,
        }, "102024160_1669972662");
    }).catch(err => {
        log.error(err);
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

function cTime(times: 1 | 10, testStar?: 1 | 2 | 3): GachaPools {

    var ret: GachaPools = [];
    if (times == 1) {
        ret.push(once());
    } else if (times == 10) {
        var must = true;
        for (var i = 1; i <= 10; i++) {
            ret.push(once(testStar));
            if (ret[ret.length - 1].star > 1) must = false;
        }
        if (must) ret[9] = once(2);
    }
    return ret;
}

function once(mustStar?: 1 | 2 | 3): GachaPool {
    //三星角色（彩色卡背）的抽取概率为2.5，二星角色（金色卡背）为18.5，一星角色（灰色卡背）为79
    if (mustStar) return { name: second(mustStar), star: mustStar };

    var rNum = Math.round(Math.random() * 1000);
    if (rNum <= 1) {
        return {
            name: {
                source: "Arona",
                chineseName: "彩奈",
                fileName: "NPC_Portrait_Arona.png"
            },
            star: 3
        }
    } else if (rNum <= 25) {
        return { name: second(3), star: 3 };
    } else if (rNum <= 25 + 185) {
        return { name: second(2), star: 2 };
    } else {
        return { name: second(1), star: 1 };
    }
}

/**
 * 根据星级，返回该星级随机出来的名称
 * @param star 星级
 * @returns 角色名称
 */
function second(star: number): Character {
    if (star == 3) {
        var c = Math.round(Math.random() * 1000) % choicesList.star3.length;
        //log.debug(`${star}(${choicesList.star3[c].source})${choicesList.star3[c].chineseName}`);
        //log.info(star + choicesList.star3[c]);
        return choicesList.star3[c];
    } else if (star == 2) {
        var c = Math.round(Math.random() * 1000) % choicesList.star2.length;
        //log.debug(`${star}(${choicesList.star2[c].source})${choicesList.star2[c].chineseName}`);
        return choicesList.star2[c];
    } else {
        var c = Math.round(Math.random() * 1000) % choicesList.star1.length;
        //log.debug(`${star}(${choicesList.star1[c].source})${choicesList.star1[c].chineseName}`);
        return choicesList.star1[c];
    }

}

async function analyzeRandData(uid: string, data: GachaPools) {

    const nowDay = (new Date()).setHours(0, 0, 0, 0) + 1000 * 60 * 60 * 24;
    const gachaSetting = await settingConfig(uid, "GET");
    if (gachaSetting.hide == "1") return null;

    const gachaData: {
        all: string[] | number[],
        today: string[] | number[],
    } = {
        all: (await redis.hGet(`data:allGacha`, `${uid}`) || "0,0,0,0").split(","),
        today: (await redis.hGet(`data:todayGacha:${nowDay}`, uid) || "0,0,0,0").split(","),
    }
    for (const o of data) {
        gachaData.all[o.star] = Number(gachaData.all[o.star]) + 1;
        gachaData.today[o.star] = Number(gachaData.today[o.star]) + 1;
    }
    await redis.hSet(`data:allGacha`, `${uid}`, gachaData.all.join());
    await redis.hSet(`data:todayGacha:${nowDay}`, uid, gachaData.today.join());
    await redis.expireAt(`data:todayGacha:${nowDay}`, nowDay);

    const _t: number[] = [];
    const _a: number[] = [];
    for (const __t of gachaData.today) {
        _t.push(Number(__t));
    }
    for (const __a of gachaData.all) {
        _a.push(Number(__a));
    }

    return {
        today_gacha: `今日${_t[1] + _t[2] + _t[3]}发，共有一星${_t[1]}个，二星${_t[2]}个，三星${_t[3]}个`,
        total_gacha: `累计${_a[1] + _a[2] + _a[3]}发，共有一星${_a[1]}个，二星${_a[2]}个，三星${_a[3]}个`,
        gacha_analyze: `今日出货概率${((_t[3] / (_t[1] + _t[2] + _t[3])) * 100).toFixed(2)}%，` +
            `累计出货概率${((_a[3] / (_a[1] + _a[2] + _a[3])) * 100).toFixed(2)}%`
    }


}

async function buildImage(characterNames: GachaPools): Promise<string> {

    if (characterNames.length == 1) {
        return "";
    } else if (characterNames.length == 10) {

        const outName = `${new Date().getTime()}.png`;
        var tmpOutPath = `${config.picPath.out}/${outName}`;
        var files: { input: string, top: number, left: number, }[] = [];

        characterNames.forEach((value, index) => {

            var x = ((index) % 5);
            var y = parseInt(`${index / 5}`.slice(0, 1));

            //log.debug(`(${x},${y})`);

            x *= 300, x += 120;
            y *= 350, y += 180;

            /* files.push({//character and star bg
                input: `${config.picPath.avatarBg}`,
                top: y - 20,
                left: x - 40,
            }); */

            files.push({//star bg
                input: `${config.picPath.starBg}`,
                top: y + 190,
                left: x - 10,
            });

            files.push({//character bg
                input: `${config.picPath.mask[value.star]}`,
                top: y - 10,
                left: x - 4,
            });


            files.push({//character avatar
                input: `${config.picPath.characters}/${value.name.fileName}`,
                top: y,
                left: x,
            });

            for (let i = 0; i < value.star; i++) {//stars
                files.push({
                    input: `${config.picPath.star}`,
                    top: y + 210,
                    left: x + 30 + i * 60,
                });
            }
        })

        return sharp(config.picPath.mainBg)
            .composite(files)
            .png({ compressionLevel: 6, quality: 5, })
            .toFile(tmpOutPath).then(() => {
                return outName;
            });
    }
    return "";
}


export async function gachaSetting(msg: IMessageGUILD) {
    const nowDay = (new Date()).setHours(0, 0, 0, 0) + 1000 * 60 * 60 * 24;
    if (/重置/.test(msg.content)) {
        return settingConfig(msg.author.id, "SET", { init: "1", hide: "0", }).then(() => {
            return redis.hSet(`data:allGacha`, `${msg.author.id}`, "0,0,0,0");
        }).then(() => {
            return redis.hSet(`data:todayGacha:${nowDay}`, msg.author.id, "0,0,0,0");
        }).then(() => {
            return msg.sendMsgExRef({
                content: `已重置卡池设置为默认` +
                    `\n已重置所有统计为空` +
                    `\n已重置统计信息为显示状态` +
                    `\n（这是一个不可撤回的操作！）`,
            })
        });
    }

    if (await redis.hExists(`setting:gacha`, `${msg.author.id}`)) {
        if (/清空(今日|全部)/.test(msg.content)) {
            const type = /今日/.test(msg.content) ? "T" : "A";
            if (type == "T") return redis.hSet(`data:todayGacha:${nowDay}`, msg.author.id, "0,0,0,0");
            else return redis.hSet(`data:allGacha`, `${msg.author.id}`, "0,0,0,0");
        } else if (/(更改显示)/.test(msg.content)) {
            const status = await settingConfig(msg.author.id, "GET");
            if (status.init == "0") {
                return msg.sendMsgExRef({ content: `未找到用户设置，请@bot后输入"/抽卡设置 重置"开始初始化设置` });
            } else {
                status.hide = status.hide == "1" ? "0" : "1";
                return settingConfig(msg.author.id, "SET", status).then(() => {
                    return msg.sendMsgExRef({ content: `已更改统计信息为: ${status.hide == "1" ? "隐藏" : "显示"}` });
                });
            }
        } else if (/帮助/.test(msg.content)) {
            return msg.sendMsgExRef({
                content: `抽卡设置 - 帮助界面\n` +
                    `========================\n` +
                    `（以下命令必须@机器人后才能使用）\n\n` +
                    `指令：/抽卡设置 重置\n` +
                    `介绍：重置所有卡池设置到默认（选择卡池、统计信息等）\n\n` +
                    `指令：/抽卡设置 清空今日\n` +
                    `介绍：清空今日抽卡统计信息\n\n` +
                    `指令：/抽卡设置 清空全部\n` +
                    `介绍：清空全部抽卡统计信息\n\n` +
                    `指令：/抽卡设置 更改显示\n` +
                    `介绍：更改抽卡统计信息显示为当前相反值（默认显示）`,
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


/**
 * key:   setting:gacha
 * field: uid
 * value: 1(init),0(show/hide),0(continue analyze),0(cut cd (?))
 * @param aid author id
 * @param types GET or SET
 * @returns GachaSetting
 */
async function settingConfig(aid: string, types: "GET"): Promise<GachaSetting>;
async function settingConfig(aid: string, types: "SET", set: Partial<GachaSetting>): Promise<GachaSetting>;
async function settingConfig(aid: string, types: "GET" | "SET", set?: Partial<GachaSetting>): Promise<GachaSetting> {

    var setting: GachaSetting;
    if (set && set.init && set.hide && set.cancel && set.poolId) {//ASET
        setting = set as GachaSetting;
    } else {
        setting = await redis.hGet("setting:gacha", aid).then(setting => {
            const splitConfig = (setting || "0,0,0,0").split(",");
            const config = {
                init: splitConfig[0] || "0",
                hide: splitConfig[1] || "0",
                cancel: splitConfig[2] || "0",
                poolId: splitConfig[3] || "0",
            }
            if (types == "GET") return config;
            else return Object.assign(config, set);
        }).catch(err => {
            log.error(err);
            return { init: "0", hide: "0", cancel: "0", poolId: "0" };
        });
    }

    const splitConfig = [];
    let key: keyof GachaSetting;
    for (key in setting) splitConfig.push(setting[key]);
    return redis.hSet(`setting:gacha`, aid, splitConfig.join()).then(() => {
        return setting;
    }).catch(err => {
        log.error(err);
        return { init: "0", hide: "0", cancel: "0", poolId: "0" };
    });
}

interface GachaSetting {
    init: string;
    hide: string;
    cancel: string;
    poolId: string;
}

type GachaPools = GachaPool[];
interface GachaPool { name: Character; star: number; };