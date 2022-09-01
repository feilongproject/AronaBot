import { findChannel } from "../mod/findChannel";
import log from "../mod/logger";
import choicesList from "../../data/choices.json";
import { buildImage } from "../mod/buildImage";
import { Messager } from "../mod/messager";
import { DatabaseAuthRand, Databaser, DatabaseUserPoolSetting } from "../mod/databaser";

var userHistory: UserHistory[] = [];
var maxTime = 60000;
var authTime = 0;

const adminId = "7681074728704576201";



export async function commandRand(pusher: Databaser, messager: Messager, userChoice: number): Promise<void> {

    if (findChannel(messager.msg.channel_id)) {

        var index = userHistory.findIndex((i) => { return i.id == messager.msg.author.id });
        var nowTime = new Date().getTime();
        await pusher.databaseSearch("authRand", "userId", messager.msg.author.id).then((datas: DatabaseAuthRand[]) => {
            //log.debug(datas);
            if (datas[0]?.userId == messager.msg.author.id) {
                authTime = 1000 * datas[0].lessTime;
            } else {
                authTime = 0;
            }
        }).catch(err => {
            log.error(err);
        });

        if ((index == -1) || (userHistory[index].lastTime + maxTime - authTime <= nowTime) || (messager.msg.author.id == adminId)) {
            //log.info(`${content}|`);
            randChoice(userChoice, pusher, messager).then(sendStr => {
                if (sendStr?.picPath) {
                    pusher.sendImage(messager, sendStr.picPath, `<@${messager.msg.author.id}>\n${sendStr.content}`);
                } else if (sendStr?.content) {
                    pusher.sendMsg(messager, sendStr.content);
                }
            });
            //switch
            if (index == -1) {
                userHistory.push({ id: messager.msg.author.id, lastTime: nowTime, });
                log.debug(`push history:${messager.msg.author.id},lastTime:${nowTime}`);
            } else {
                userHistory[index].lastTime = nowTime;
            }
        } else {
            pusher.sendMsg(messager, `请求时间过短，还有${(userHistory[index].lastTime + maxTime - authTime - nowTime) / 1000}s冷却完毕\n(因为当前服务器性能不足，所以设置冷却cd，赞助以购买一个更好的服务器，也可以获得更少的冷却时间！)\n（当拥有更高配置的服务器时会取消冷却cd限制！）\n（同时为开发者的女装计划助力！）`);
        }


    } else {
        log.error(`unAuth channel id:${messager.msg.channel_id}|||user:${messager.msg.author.username}`);
        pusher.sendMsg(messager, `当前子频道未授权,请在隔壁使用`);
    }


}

/**
 * 对二进制判断，并返回结果（当未知时返回null）
 * 二进制位数介绍：
 * 第0位：1/0（十连/单抽）
 * 第1位：1/0（图片/文本）
 * @param choices 选择条件，以二进制为准
 * @returns 返回本次抽卡结果
 */
async function randChoice(choices: number, pusher: Databaser, messager: Messager): Promise<{ content?: string, picPath?: string } | null> {
    //三星角色（彩色卡背）的抽取概率为2.5，二星角色（金色卡背）为18.5，一星角色（灰色卡背）为79

    switch (choices) {
        case 0b00://str + 1times

            var o = cTime(1);
            return {
                content: `————————单抽结果————————\n` +
                    `(${choicesList.starString[o[0].star]})(${o[0].name.source})${o[0].name.chineseName}`
            };

        case 0b01://str + 10times
            var content = `————————十连结果————————\n`;

            var o = cTime(10);
            o.forEach((value, index) => {
                content += `(${choicesList.starString[o[index].star]})(${o[index].name.source})${o[index].name.chineseName}\n`;
            });

            return {
                content: content +
                    `—————————————————————\n` +
                    `结果仅供娱乐，具体请以实际欧/非气为准` + `\n图片抽卡功能添加完成，目前可用`
            };

        case 0b10://image + 1times

            return null;
        case 0b11://image + 10times
            var o = cTime(10);
            return {
                picPath: await buildImage(o),
                content: await analyzeRandData(pusher, messager, o),
            };
        default:
            return null;
    }

}

function cTime(times: 1 | 10): { name: Character, star: number }[] {

    var ret: { name: Character, star: number }[] = [];
    if (times == 1) {
        ret.push(once());
    } else if (times == 10) {
        var must = true;
        var _arr = Array.from({ length: 10 }, (v, k) => k);

        _arr.forEach((value, index) => {
            if (index == 9 && must == true) {
                ret.push(once(2));
            } else {
                var o = once();
                if (o.star > 1) must = false;
                ret.push(o);


            }
        });
    }
    return ret;
}

function once(mustStar?: 1 | 2 | 3): { name: Character, star: number } {
    var rNum = Math.round(Math.random() * 1000);
    //log.debug(rNum);
    if (mustStar) return { name: second(mustStar), star: mustStar };
    if (rNum <= 25) {
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
        log.info(`${star}(${choicesList.star3[c].source})${choicesList.star3[c].chineseName}`);
        //log.info(star + choicesList.star3[c]);
        return choicesList.star3[c];
    } else if (star == 2) {
        var c = Math.round(Math.random() * 1000) % choicesList.star2.length;
        log.info(`${star}(${choicesList.star2[c].source})${choicesList.star2[c].chineseName}`);
        return choicesList.star2[c];
    } else {
        var c = Math.round(Math.random() * 1000) % choicesList.star1.length;
        log.info(`${star}(${choicesList.star1[c].source})${choicesList.star1[c].chineseName}`);
        return choicesList.star1[c];
    }

}

async function analyzeRandData(pusher: Databaser, messager: Messager, data: { name: Character, star: number }[]): Promise<string> {
    var stars = [
        0, 0, 0, 0,
    ];

    data.forEach(value => {
        stars[value.star]++;
    });

    return pusher.databaseSearch("userPoolSetting", "userId", messager.msg.author.id).then((data: DatabaseUserPoolSetting[]) => {
        if (data[0]?.userId.toString() == messager.msg.author.id) {
            var setting = data[0];
            if (setting.hide) return ``;

            setting.randedAll.star1 += stars[1];
            setting.randedAll.star2 += stars[2];
            setting.randedAll.star3 += stars[3];

            var randedTodayTs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
            if (setting.randedTodayTs == randedTodayTs) {
                setting.randedToday.star1 += stars[1];
                setting.randedToday.star2 += stars[2];
                setting.randedToday.star3 += stars[3];
            } else {
                setting.randedTodayTs = randedTodayTs;
                setting.randedToday.star1 = stars[1];
                setting.randedToday.star2 = stars[2];
                setting.randedToday.star3 = stars[3];
            }

            pusher.databasePushPoolSetting(setting, true).catch(err => {
                log.error(err);
            });

            const _Today = setting.randedToday;
            const _All = setting.randedAll;
            //log.debug(_Today, _All);
            return `抽卡统计：\n` +
                //`当前：一星${stars[1]}个，二星${stars[2]}个，三星${stars[3]}个\n` +
                `今日${_Today.star1 + _Today.star2 + _Today.star3}发，共有一星${_Today.star1}个，二星${_Today.star2}个，三星${_Today.star3}个\n` +
                `累计${_All.star1 + _All.star2 + _All.star3}发，共有一星${_All.star1}个，二星${_All.star2}个，三星${_All.star3}个\n` +
                `今日出货概率${((_Today.star3 / (_Today.star1 + _Today.star2 + _Today.star3)) * 100).toFixed(2)}%，` +
                `累计出货概率${((_All.star3 / (_All.star1 + _All.star2 + _All.star3)) * 100).toFixed(2)}%`;
        } else {
            return `未开启抽卡统计，当次抽卡不会记录\n(@机器人后使用指令"/抽卡设置 重置"初始化设置)`;
        }
    }).catch(err => {
        log.error(err);
        return `在统计发生了一些问题，请联系bot管理员解决`;
    });

}


interface UserHistory {
    id: string,
    lastTime: number,
}
