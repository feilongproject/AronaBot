import fs from "fs";
import fetch from "node-fetch";
import { IMessageGUILD } from "../libs/IMessageEx";
const signDataFile = "./data/signData.json";

export async function sign(msg: IMessageGUILD) {

    var data = fs.readFileSync(signDataFile, { encoding: "utf-8" });
    if (data.trim() == "") data = "{}";
    var signData: SignData = JSON.parse(data);


    /**
     * ststus
     * 0:not found in sign users
     * 1:found but not continue sign
     * 2:found and continue sign
     * 3:found and already signed at today
     */
    var nowDate = new Date();
    var todayDate = new Date(new Date().setHours(0, 0, 0, 0));

    if (!signData.users) signData.users = [];
    var ststus = 0;
    var sendStr = `————————签到结果————————\n`;

    signData.users.forEach((user, index) => {
        if (user.base.id == msg.author.id) {//found

            if (user.signHistory[user.signHistory.length - 1].todayDate == todayDate.getTime()) {//3:already signed at today 
                log.debug("type:3,found and already signed at today");
                ststus = 3;

                sendStr += `已签到，请勿重复签到`;
            } else if (user.signHistory[user.signHistory.length - 1].todayDate + 24 * 60 * 60 * 1000 == todayDate.getTime()) {//2:continue sign
                log.debug("type:2,found and continue sign");
                ststus = 2;

                signData.users[index].totalSignDay++;
                signData.users[index].continueSignDay++;//
                signData.users[index].exp.total += signData.users[index].continueSignDay;
                signData.users[index].exp.history.push({
                    date: nowDate.getTime(),
                    num: signData.users[index].continueSignDay,
                    why: `续签，exp+${signData.users[index].continueSignDay}`,
                });
                signData.users[index].signHistory.push({ nowDate: nowDate.getTime(), todayDate: todayDate.getTime(), });

                sendStr +=
                    `已续签，连续签到${signData.users[index].continueSignDay}天,累计签到${signData.users[index].totalSignDay}天\n` +
                    `获得${signData.users[index].exp.history[signData.users[index].exp.history.length - 1].num}exp,总共${signData.users[index].exp.total}exp`;
            } else {//1:not continue sign
                log.debug("type:1,found but not continue sign");
                ststus = 1;
                signData.users[index].totalSignDay++;
                signData.users[index].continueSignDay = 1;//
                signData.users[index].exp.total += signData.users[index].continueSignDay;
                signData.users[index].exp.history.push({
                    date: nowDate.getTime(),
                    num: signData.users[index].continueSignDay,
                    why: `续签，exp+${signData.users[index].continueSignDay}`,
                });
                signData.users[index].signHistory.push({ nowDate: nowDate.getTime(), todayDate: todayDate.getTime(), });

                sendStr +=
                    `断签已续，连续签到${signData.users[index].continueSignDay}天,累计签到${signData.users[index].totalSignDay}天\n` +
                    `获得${signData.users[index].exp.history[signData.users[index].exp.history.length - 1].num}exp,总共${signData.users[index].exp.total}exp`;

            }

        }
    });

    if (ststus == 0) {//0:not found in sign users(create a user)
        log.debug("type:0,not found in sign users(create a user)");
        signData.users.push({
            base: { id: msg.author.id, name: msg.author.username, },
            exp: {
                total: 10,
                history: [{ date: nowDate.getTime(), num: 10, why: "初次使用签到功能", }],
            },
            totalSignDay: 1,
            continueSignDay: 1,
            signHistory: [{ nowDate: nowDate.getTime(), todayDate: todayDate.getTime(), }],
        });

        sendStr +=
            `第一次使用签到，连续签到${signData.users[signData.users.length - 1].continueSignDay}天,累计签到${signData.users[signData.users.length - 1].totalSignDay}天\n` +
            `获得经验${signData.users[signData.users.length - 1].exp.history[signData.users[signData.users.length - 1].exp.history.length - 1].num}exp,总共经验${signData.users[signData.users.length - 1].exp.total}exp`;

    }

    if (ststus == 2 || ststus == 1 || ststus == 0) {
        sendStr +=
            `\n今日运势:${todayLucky()}`;
    }

    if (ststus == 2 || ststus == 1 || ststus == 0) {
        try {
            if (!signData.randomPoem) signData.randomPoem = { token: await getRandomPoemToken() };
            const poem: RandomPoemSentence | null = await getRandomPoem(signData.randomPoem.token);
            if (poem.data) {
                sendStr +=
                    `\n————————今日诗词————————\n` +
                    `《${poem.data.origin.title}》${poem.data.origin.author}\n`;

                sendStr += poem.data.origin.content.join("\n");
            } else {
                sendStr += poem;
            }
        } catch (error) {
            log.error(error);
        }
    }

    msg.sendMsgExRef({ content: sendStr });
    fs.writeFileSync(signDataFile, JSON.stringify(signData), { encoding: "utf-8" });

}

function getRandomPoem(token: RandomPoemToken): Promise<RandomPoemSentence> {

    log.debug(`geting sentence`);
    var sentence: Promise<RandomPoemSentence> = fetch("https://v2.jinrishici.com/sentence", {
        headers: {
            "X-User-Token": token.data,
        },
    }).then(res => {
        return res.json();
    }).catch(err => {
        log.error(err);
    });
    return sentence;

}

function getRandomPoemToken(): Promise<RandomPoemToken> {

    log.error(`get token`);
    var token: Promise<RandomPoemToken> = fetch("https://v2.jinrishici.com/token").then(res => {
        return res.json();
    });
    return token;
}

function todayLucky(): string {

    var content = ``;
    var rand = Math.random();

    if (rand <= 0.2) {//[0.00,0.20]20%
        content += `大吉`;
    } else if (rand <= 0.4) {//(0.20~0.40]20%
        content += `小吉`;
    } else if (rand <= 0.2) {//(0.40~0.80]40%
        content += `吉`;
    } else if (rand <= 0.9) {//(0.80~0.90]10%
        content += `凶`;
    } else if (rand <= 1) {//(0.90~1.00]10%
        content += `大凶`;
    }
    return content;
}

interface SignData {
    randomPoem: {
        token: RandomPoemToken,
    },
    users: UserInfo[]//
}

interface UserInfo {
    base: Member,
    exp: Exp,
    totalSignDay: number,
    continueSignDay: number,
    signHistory: SignHistory[],
}

interface Exp {
    total: number,
    history: ExpHistory[],
}

interface ExpHistory {
    date: number,
    num: number,
    why: string,
}

interface SignHistory {
    nowDate: number,
    todayDate: number,
}

interface RandomPoemToken {
    status: "success",
    data: string,
}

interface RandomPoemSentence {
    status: "success" | "error",
    data: {
        id: string,
        content: string,
        popularity: number,
        origin: {
            title: string,
            dynasty: string,
            author: string,
            content: string[],
            translate: null,
        },
        matchTags: string[],
        recommendedReason: string,
        cacheAt: string,
    },
    token: string,
    ipAddress: string,
    warning: null,

    errCode?: 1001 | 1002 | 2002 | 2003,
}