import os from "os";
import qr from "qr-image";
import Excel from "exceljs";
import xlsx from 'node-xlsx';
import format from "date-format";
import { IUser } from "qq-guild-bot";
import child_process from "child_process";
import { reloadStudentInfo } from "../libs/common";
import { IMessageDIRECT, IMessageGUILD } from "../libs/IMessageEx";


export async function help(msg: IMessageDIRECT) {
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
                `╠ ${opt.fnc}`,
                `┃ ┣ reg:  ${opt.reg}`,
                `┃ ┣ type: ${opt.type}`,
                `┃ ┗ desc: ${opt.describe}`,
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

export async function ping(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    return msg.sendMsgEx({ content: await global.redis.ping() });
}

export async function hotLoad(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    if (devEnv) return;
    const times = /^\/?热(加载|更新)(-?\d+)$/.exec(msg.content)![2];
    hotLoadStatus = Number(times);
    return msg.sendMsgEx({ content: `已${msg.content}` });
}

export async function controlMarkdown(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    showMarkdown = /关闭/.test(msg.content) ? false : true;
    return msg.sendMsgEx({ content: `已${msg.content}` });
}

export async function mute(msg: IMessageGUILD) {
    const author = msg.member;
    if (!author || !author.roles || !(author.roles.includes("2") || author.roles.includes("4") || author.roles.includes("5"))) return;

    const timeExec = /(抽卡|晒卡)?禁言(\d+)((分钟?|m)|(小?时|h)|(天|d))/.exec(msg.content);
    if (!timeExec) return msg.sendMsgExRef({ content: `未指定禁言时间` });
    timeExec[1] = timeExec[1] || "";
    const muteTime = Number(timeExec[2]) * (timeExec[4] ? 60 : timeExec[5] ? 60 * 60 : 60 * 60 * 24);
    const muteType = timeExec[1] ? "gacha" : "common";

    var muteMember: IUser | null = null;
    for (const mention of (msg.mentions || [])) if (!mention.bot) muteMember = mention;
    if (!muteMember) return msg.sendMsgExRef({ content: `未指定禁言对象` });
    if (msg.author.id == muteMember.id) return msg.sendMsgExRef({ content: "禁止禁言自己" });
    if (muteTime && muteType == "gacha" && !msg.message_reference) return msg.sendMsgExRef({ content: `未找到需要撤回消息` });

    const alart = await client.guildApi.guildMember(msg.guild_id, muteMember.id).then(res => {
        const { data } = res;
        if (!data || !data.roles) return null;
        if (data.roles.includes("4")) return "无法禁言频道主";
        if (data.roles.includes("2")) return "无法禁言超级管理员";
        if (data.roles.includes("5")) return "无法禁言子频道管理员";
        return null;
    }).catch(err => {
        log.error(err);
        return `获取出错: ${String(err).replaceAll(".", "。")}`;
    });
    if (alart) return msg.sendMsgExRef({ content: alart });

    return msg.sendMsgEx({//通知adminId
        content: `管理执行${muteType}禁言权限` +
            `\n\n权限: ${JSON.stringify(msg?.member?.roles)}` +
            `\n管理: ${msg.author.username}(${msg.author.id})` +
            `\n目标: ${muteMember.username}(${muteMember.id})` +
            `\n\n频道: ${msg.guildName}(${msg.guild_id})` +
            `\n子频道: ${msg.channelName}(${msg.channel_id})` +
            `\n时间: ${timeConver(muteTime * 1000)}`,
        guildId: await global.redis.hGet(`directUid->Gid`, adminId[0]),
        sendType: "DIRECT",
    }).then(() => muteTime
        ? redis.hSet(`mute:${muteMember!.id}`, new Date().getTime(), muteType)
            .then(() => msg.sendMsgExRef({ content: `已对成员<@${muteMember!.id}>${timeExec[1]}禁言${timeConver(muteTime * 1000)}` }))
        : msg.sendMsgExRef({ content: `已解除${timeExec[1]}禁言` })
    ).then(() => redis.hGetAll(`mute:${muteMember!.id}`)
    ).then(muteInfo => {
        const sendStr = ["禁言记录"];
        for (const _timestamp in muteInfo) sendStr.push(`时间: ${format.asString(new Date(Number(_timestamp)))} | 类型: ${muteInfo[_timestamp]}`);
        return msg.sendMsgExRef({ content: sendStr.join("\n") });
    }).then(() => client.muteApi.muteMember(msg.guild_id, muteMember!.id, { seconds: muteTime.toString() })
    ).then(() => (muteType == "gacha" && muteTime)
        ? client.messageApi.deleteMessage(msg.channel_id, msg.message_reference!.message_id).then(async () =>
            msg.sendMsgEx({
                content: `<@${muteMember!.id}>(id: ${muteMember!.id})` +
                    `\n禁言${timeExec[2]}${timeExec[3]}` +
                    `\n原因: 晒卡` +
                    `\n子频道: <#${msg.channel_id}>(id: ${msg.channel_id})` +
                    `\n处理人: <@${msg.author.id}>(id: ${msg.author.id})` +
                    `\n注意: 该消息由bot自动发送，如有异议联系<@${msg.author.id}>或<@${adminId[0]}>`,
                channelId: await redis.hGet("mute:sendChannel", msg.guild_id)
            })
        ) : undefined
    ).catch(err => {
        log.error(err);
        msg.sendMsgExRef({ content: `禁言出现错误<@${adminId[0]}>\n` + JSON.stringify(err) });
    });
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

function timeConver(ms: number) {
    ms = Number((ms / 1000).toFixed(0));

    if (ms == 0) return "0分钟";
    if (ms < 60) return "不足1分钟";

    const s = ms % 60;
    ms = (ms - s) / 60;

    const m = ms % 60;
    ms = (ms - m) / 60;

    const h = ms % 24;
    ms = (ms - h) / 24;

    return `${ms ? `${ms}天 ` : ``}${h ? `${h}小时 ` : ``}${m ? `${m}分钟 ` : ``}`;
}