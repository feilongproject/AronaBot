import os from "os";
import qr from "qr-image";
import Excel from "exceljs";
import xlsx from 'node-xlsx';
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import child_process from "child_process";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";
import { reloadStudentInfo, sendToAdmin, timeConver } from "../libs/common";


export async function updateEventId(event?: IntentMessage.GUILD_MEMBERS) {
    const opUserId = "15874984758683127001";
    if (devEnv) log.debug(event?.eventId);
    if (event?.msg.user.id == opUserId) {
        return await redis.setEx(`lastestEventId:${event.msg.guild_id}`, 60 * 4, event.eventId,);
    }
    if (event) return;

    for (const guildId in saveGuildsTree) {
        const channel = Object.values(saveGuildsTree[guildId].channels).find(v => v.name == "bot操作记录日志");
        if (!channel) continue;
        if (devEnv && guildId != "9919414431536104110") continue;

        await client.memberApi.memberAddRole(guildId, "5", opUserId, channel.id).catch(err => {
            log.error(err);
            sendToAdmin(JSON.stringify(err).replaceAll(".", "。")).catch(err => log.error(err));
        });
    }
}

export async function updateGithubVersion(msg?: IMessageDIRECT) {
    if (!devEnv && await redis.exists("push:ghUpdate")) return;

    const queue: Promise<string>[] = [];
    const regexp = /This branch is ((\d+) commits? ahead,? (of)?)?((\d+) commits? behind)?(up to date with)? lonqie(\/SchaleDB)?:main/;
    for (const _ of Array.from({ length: 5 })) {
        queue.push(fetch("https://p.prpr.cf/feilongproject/SchaleDB?host=github.com", { timeout: 10 * 1000 }).then(res => res.text()).catch(err => ""));
        queue.push(fetch("https://github.com/feilongproject/SchaleDB", { timeout: 10 * 1000 }).then(res => res.text()).catch(err => ""));
    }

    return Promise.all(queue).then(htmls => {

        const matches = htmls.map(html => {
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
        sendToAdmin("updateGithubVersion\n" + JSON.stringify(err).replaceAll(".", "。"));
    }).catch(err => {
        log.error(err);
    });

}

export async function help(msg: IMessageGUILD | IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;

    const optss: {
        [fileName: string]: {
            [optName: string]: {
                reg: string;
                fnc: string;
                type: string[];
                describe: string;
                channelAllows?: string[];
            }
        }
    } = (await import("../../config/opts.json")).default.command;

    const sendStr: string[] = ["当前所有命令:"];
    for (const optsName in optss) {
        const opts = optss[optsName];
        sendStr.push(`${optsName}`);
        for (const optName in opts) {
            const opt = opts[optName];
            sendStr.push(
                `╠ ${opt.fnc} [${opt.type}]`,
                // `- ┣ reg:  ${opt.reg}`,
                `- ┗ desc: ${opt.describe}`,
            );
        }
        sendStr.push("");
    }
    sendStr.push(
        `常用:`,
        `碧蓝档案(7487571598174764531)`,
        `🕹ba攻略分享贴(7389666)`,
        `BA彩奈测试频道(9919414431536104110)`,
        `测试频道1(7519512)`,
        "测试帖子频道(14432713)",
    );

    return msg.sendMsgEx({
        content: sendStr.join("\n"),
    });
}

export async function status(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    const content = `------状态------` +
        `\n系统版本：${child_process.execSync("lsb_release -d").toString().split(/(\t|\n)/)[2]}` +
        `\n内核版本：${child_process.execSync("uname -a").toString().split(/(\t|\n|\ )/)[4]}` +
        `\n运行时间：${timeConver(new Date().getTime() - global.botStatus.startTime.getTime())}` +
        `\n发送消息：${global.botStatus.msgSendNum}条` +
        `\n生成图片：${global.botStatus.imageRenderNum}次` +
        `\n内存使用：${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)}MB` +
        `\n系统内存：${(os.freemem() / 1024 / 1024).toFixed()}MB/${(os.totalmem() / 1024 / 1024).toFixed()}MB (free/total)` +
        `\n系统已开机：${timeConver(os.uptime() * 1000)}`;
    log.debug(`\n` + content);
    return msg.sendMsgEx({ content });
}

export async function ping(msg: IMessageGUILD | IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    // log.debug(msg);
    return msg.sendMsgEx({ content: await global.redis.ping() });
}

export async function hotLoad(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    if (devEnv) return;
    const times = /^\/?热(加载|更新)(-?\d+)$/.exec(msg.content)![2];
    hotLoadStatus = Number(times);
    return msg.sendMsgEx({ content: `已${msg.content}` });
}

export async function directToAdmin(msg: IMessageDIRECT) {
    if (adminId.includes(msg.author.id)) {
        //log.debug(`refMid:${msg.message_reference?.message_id}`);
        const refMsgGid = await redis.hGet(`directMid->Gid`, msg.message_reference?.message_id || `0`);
        //log.debug(refMsgGid);
        if (!refMsgGid) return;
        return msg.sendMsgEx({
            content: msg.content,
            guildId: refMsgGid,
        }).then(() => {
            return msg.sendMsgEx({ content: `消息已发送` });
        });
    }

    return msg.sendMsgEx({
        content: `用户：${msg.author.username}发送了一条信息` +
            `\n用户id：${msg.author.id}` +
            `\n源频道：${msg.src_guild_id}` +
            `\n内容：${msg.content}`,
        guildId: await global.redis.hGet(`directUid->Gid`, adminId[0]),
    }).then(res => {
        if (res?.result) return redis.hSet(`directMid->Gid`, res.result.id, msg.guild_id);
    });
}

export async function reloadStudentData(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    const type = /^学生数据(网络|本地)重加载$/.exec(msg.content)![1];
    return reloadStudentInfo(type == "网络" ? "net" : "local")
        .then(r => msg.sendMsgExRef({ content: `已从${type}重加载资源并保存\n${r}` }))
        .catch(err => {
            log.error(err);
            return msg.sendMsgExRef({ content: `${type}获取资源错误: ${err}` });
        });
}

export async function dumpChatRecord(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;

    const exec = /dump\s*(\d+)/.exec(msg.content)!!;
    const aid = exec[1];
    if (!aid) return msg.sendMsgEx({ content: `未指定id` });
    const saveFileName = `${aid}-${new Date().getTime()}.xlsx`;
    return mariadb.query("SELECT * FROM `guildMessage` WHERE `aid` = (?) ORDER BY `guildMessage`.`ts` ASC", aid).then(datas => {
        const { meta } = datas;

        // const sheetData: any[][] = [];
        // const headers = meta.map((column: any) => column.name());
        // sheetData.push(headers);
        // datas.forEach((data: any[]) => {
        //     const rowData = headers.map((header: any) => data[header]);
        //     sheetData.push(rowData);
        // });
        // fs.writeFileSync(`${_path}/log/record/${saveFileName}`, xlsx.build([{ name: aid, data: sheetData, options: {} }]));

        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet(aid);
        const columnsMap = meta.map((column: any) => ({
            header: column.name(),
            key: column.name(),
        }));
        worksheet.columns = columnsMap;
        for (const data of datas) worksheet.addRow(data);
        return workbook.xlsx.writeFile(`${_path}/log/record/${saveFileName}`);
    }).then(() => msg.sendMsgEx({
        imageFile: qr.imageSync(`https://ip.arona.schale.top/p/record/${saveFileName}`),
        content: `用户 ${aid} 日志已转存\n`
            + saveFileName
        // + `ip。arona。schale。top/p/record/${saveFileName}`,
        // + "https://ip,arona,schale,top/p/record/15874984758683127001-1682781508632.xlsx"
    })).catch(err => {
        log.error(err);
    });
}
