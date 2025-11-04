// TODO: 什么时候重构？
import fs from 'fs';
import axios from 'axios';
import { IMessageGUILD } from '../libs/IMessageEx';
const signDataFile = './data/signData.json';

export async function sign(msg: IMessageGUILD) {
    var data = fs.readFileSync(signDataFile, { encoding: 'utf-8' });
    if (data.trim() == '') data = '{}';
    var signData: SignData.Root = JSON.parse(data);

    /**
     * ststus
     * 0:not found in sign users
     * 1:found but not continue sign
     * 2:found and continue sign
     * 3:found and already signed at today
     */
    var ststus = 0;
    var nowDate = new Date();
    var sendStr = `————————签到结果————————\n`;
    var todayDate = new Date(new Date().setHours(0, 0, 0, 0));
    if (!signData.users) signData.users = [];

    for (const [index, user] of signData.users.entries()) {
        if (user.base.id != msg.author.id) continue; //not found
        if (user.signHistory[user.signHistory.length - 1].todayDate == todayDate.getTime()) {
            //3:already signed at today
            //log.debug("type:3,found and already signed at today");
            ststus = 3;
            sendStr += `已签到，请勿重复签到`;
        } else if (
            user.signHistory[user.signHistory.length - 1].todayDate + 24 * 60 * 60 * 1000 ==
            todayDate.getTime()
        ) {
            //2:continue sign
            //log.debug("type:2,found and continue sign");
            ststus = 2;
            signData.users[index].totalSignDay++;
            signData.users[index].continueSignDay++; //
            signData.users[index].exp.total += signData.users[index].continueSignDay;
            signData.users[index].exp.history.push({
                date: nowDate.getTime(),
                num: signData.users[index].continueSignDay,
                why: `续签，exp+${signData.users[index].continueSignDay}`,
            });
            signData.users[index].signHistory.push({
                nowDate: nowDate.getTime(),
                todayDate: todayDate.getTime(),
            });

            sendStr +=
                `已续签，连续签到${signData.users[index].continueSignDay}天,累计签到${signData.users[index].totalSignDay}天\n` +
                `获得${signData.users[index].exp.history[signData.users[index].exp.history.length - 1].num}exp,总共${signData.users[index].exp.total}exp`;
        } else {
            //1:not continue sign
            //log.debug("type:1,found but not continue sign");
            ststus = 1;
            signData.users[index].totalSignDay++;
            signData.users[index].continueSignDay = 1; //
            signData.users[index].exp.total += signData.users[index].continueSignDay;
            signData.users[index].exp.history.push({
                date: nowDate.getTime(),
                num: signData.users[index].continueSignDay,
                why: `续签，exp+${signData.users[index].continueSignDay}`,
            });
            signData.users[index].signHistory.push({
                nowDate: nowDate.getTime(),
                todayDate: todayDate.getTime(),
            });

            sendStr +=
                `断签已续，连续签到${signData.users[index].continueSignDay}天,累计签到${signData.users[index].totalSignDay}天\n` +
                `获得${signData.users[index].exp.history[signData.users[index].exp.history.length - 1].num}exp,总共${signData.users[index].exp.total}exp`;
        }
    }

    if (ststus == 0) {
        //0:not found in sign users(create a user)
        //log.debug("type:0,not found in sign users(create a user)");
        signData.users.push({
            base: { id: msg.author.id, name: msg.author.username },
            exp: {
                total: 10,
                history: [{ date: nowDate.getTime(), num: 10, why: '初次使用签到功能' }],
            },
            totalSignDay: 1,
            continueSignDay: 1,
            signHistory: [{ nowDate: nowDate.getTime(), todayDate: todayDate.getTime() }],
        });

        sendStr +=
            `第一次使用签到，连续签到${signData.users[signData.users.length - 1].continueSignDay}天,累计签到${signData.users[signData.users.length - 1].totalSignDay}天\n` +
            `获得经验${signData.users[signData.users.length - 1].exp.history[signData.users[signData.users.length - 1].exp.history.length - 1].num}exp,总共经验${signData.users[signData.users.length - 1].exp.total}exp`;
    }

    if (ststus != 3) {
        sendStr += `\n今日运势: ${todayLucky()}`;
        if (!signData.randomPoem) signData.randomPoem = { token: await getRandomPoemToken() };
        const poem = await getRandomPoem(signData.randomPoem.token);
        if (poem)
            sendStr += `\n————————今日诗词————————\n《${poem.title}》${poem.author}\n${poem.content.join('\n')}`;
        else sendStr += `今日诗词获取失败`;

        return msg
            .sendMsgExRef({ content: sendStr })
            .then(() => {
                fs.writeFileSync(signDataFile, JSON.stringify(signData), { encoding: 'utf-8' });
            })
            .catch((err) => {
                log.error(err);
                return msg.sendMsgExRef({ content: `今日运势获取失败` });
            });
    } else {
        return msg.sendMsgExRef({ content: sendStr });
    }
}

function getRandomPoem(token: RandomPoem.Token): Promise<RandomPoem.SentenceOrigin | void> {
    //log.debug(`geting sentence`);
    return axios<RandomPoem.Sentence>({
        url: 'https://v2.jinrishici.com/sentence',
        headers: { 'X-User-Token': token.data },
    })
        .then((res) => res.data)
        .then((data) => data.data.origin)
        .catch((err) => log.error(err));
}

async function getRandomPoemToken(): Promise<RandomPoem.Token> {
    log.error(`get token`);
    return axios<RandomPoem.Token>('https://v2.jinrishici.com/token').then((res) => res.data);
}

function todayLucky() {
    const rand = Math.random();
    if (rand <= 0.2)
        return `大吉`; //[0.00,0.20]20%
    else if (rand <= 0.4)
        return `小吉`; //(0.20~0.40]20%
    else if (rand <= 0.9)
        return `吉`; //(0.40~0.90]50%
    else if (rand <= 0.95)
        return `凶`; //(0.90~0.95]5%
    else if (rand <= 1)
        return `大凶`; //(0.95~1.00]5%
    else return '■■■■';
    //大吉 中吉 小吉 吉 半吉 末吉 末小吉
}

namespace SignData {
    export interface Root {
        randomPoem: { token: RandomPoem.Token };
        users: UserInfo[];
    }
    interface UserInfo {
        base: Member;
        exp: Exp;
        totalSignDay: number;
        continueSignDay: number;
        signHistory: SignHistory[];
    }
    interface Exp {
        total: number;
        history: ExpHistory[];
    }
    interface ExpHistory {
        date: number;
        num: number;
        why: string;
    }
    interface SignHistory {
        nowDate: number;
        todayDate: number;
    }
}

namespace RandomPoem {
    export interface Token {
        status: 'success';
        data: string;
    }

    export interface Sentence {
        status: 'success' | 'error';
        data: SentenceData;
        token: string;
        ipAddress: string;
        warning: null;
        errCode?: 1001 | 1002 | 2002 | 2003;
    }

    export interface SentenceData {
        id: string;
        content: string;
        popularity: number;
        origin: SentenceOrigin;
        matchTags: string[];
        recommendedReason: string;
        cacheAt: string;
    }

    export interface SentenceOrigin {
        title: string;
        dynasty: string;
        author: string;
        content: string[];
        translate: null;
    }
}
