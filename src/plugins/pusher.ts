import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { sendToAdmin } from "../libs/common";
import { IMessageDIRECT } from "../libs/IMessageEx";


export async function updateGithubVersion(msg?: IMessageDIRECT) {
    if (!devEnv && await redis.exists("push:ghUpdate")) return;

    const queue: Promise<string>[] = [];
    const regexp = /This branch is ((\d+) commits? ahead,? (of)?)?((\d+) commits? behind)?(up to date with)? lonqie(\/SchaleDB)?:main/;
    for (const _ of Array.from({ length: 5 })) {
        queue.push(fetch("http://gh.schale.top/feilongproject/SchaleDB", { timeout: 10 * 1000 }).then(res => res.text()).catch(err => ""));
        queue.push(fetch("https://github.com/feilongproject/SchaleDB", { timeout: 10 * 1000 }).then(res => res.text()).catch(err => ""));
    }

    return Promise.all(queue).then(htmls => {

        const matches = htmls.map(html => {
            if (!html) return null;
            const reg = regexp.exec(cheerio.load(html)("#repo-content-pjax-container > div > div").text());
            return reg && reg[0] ? reg[0] : null;
        });
        const matched = matches.find(v => v);
        if (!matched) throw "reg unmatched";

        const reg = regexp.exec(matched)!;
        if (msg) return msg.sendMsgEx({ content: reg[0] });

        const behind = reg[5];
        if (behind) return sendToAdmin(reg[0]).then(() => redis.setEx("push:ghUpdate", 60 * 60 * 1, behind) as any);
        // log.debug("ahead:", reg[2], "behind:", reg[5], reg[6]);
    }).catch(err => {
        log.error(err);
        return sendToAdmin("updateGithubVersion\n" + JSON.stringify(err).replaceAll(".", "。"));
    }).catch(err => {
        log.error(err);
    });

}