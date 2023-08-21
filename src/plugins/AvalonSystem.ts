import fs from "fs";
import fetch from "node-fetch";
import format from "date-format";
import { PythonShell } from "python-shell";
import { sendToAdmin } from "../libs/common";
import { IMessageGUILD, IMessageDIRECT } from "../libs/IMessageEx";
import config from "../../config/config.json";

var isChecking = false;


export async function accuseGacha(msg: IMessageGUILD) {

    if (msg.channel_id == "1952333") return msg.sendMsgEx({ content: "要不先看看子频道名字?" });
    if (!msg.message_reference) return msg.sendMsgExRef({ content: `未指定引用信息` });
    if (isChecking) return msg.sendMsgExRef({ content: `当前队列中存在正在检测的图片, 请稍候` });

    const srcMsg = await client.messageApi
        .message(msg.channel_id, msg.message_reference!.message_id)
        .then(data => new IMessageGUILD({ ...data.data.message, seq: 0, seq_in_channel: "" }, false));
    if (!srcMsg.attachments) return "引用消息中不存在图片信息";

    await sendToAdmin(`accuseGacha触发` +
        `\n子频道: ${msg.channelName}(${msg.channel_id})` +
        `\n目标: ${srcMsg.author.username}(${srcMsg.author.id})` +
        `\n举报人: ${msg.author.username}(${msg.author.id})`
    );
    const sendAccuseGachaInfoChannel = await redis.hGet("mute:sendAccuseGachaInfoChannel", msg.guild_id);
    if (!sendAccuseGachaInfoChannel) return msg.sendMsgExRef({ content: "未指定发送频道" });


    try {
        isChecking = true;
        await msg.sendMsgExRef({
            content: `正在检测中...` +
                `\n注意: 该步骤会对服务器CPU与内存资源造成大量消耗, 若无意义使用(指对明显没有三星的图片使用)或恶意使用可能会导致无法使用bot任何功能, 具体规定请看<#7673195>子频道`,
        });
        const gachaInfo = await accuseGachaWapper(srcMsg);
        // log.debug(gachaInfo[0].gachaInfo[0]);
        if (!gachaInfo.map(v => v.possibleTotal).reduce((a, b) => a + b)) {
            isChecking = false;
            return msg.sendMsgExRef({ content: `opencv 未匹配到角色特征 <@${adminId[0]}>` });
        }
        // await msg.sendMsgExRef({ content: "存在角色特征, 继续执行" });
        var total3star = 0;
        const miserableNames = ["Saya", "Izumi", "Sumire", "Saya_Casual"];// 鼠 八 堇 便服鼠
        var isMiserable = false;
        for (const [i, gacha] of gachaInfo.entries()) {
            const studentInfo: StudentInfo[] = gacha.gachaInfo.map(v => v.pop()) as any;
            await msg.sendMsgEx({
                content: `子频道: ${msg.channelName}(${msg.channel_id})` +
                    `\n目标: ${srcMsg.author.username}(${srcMsg.author.id})` +
                    `\n举报人: ${msg.author.username}(${msg.author.id})` +
                    `\n第${i + 1}张图检测统计(${gacha.possibleTotal}): \n` +
                    gacha.gachaInfo.map((vv, vi) =>
                        `${studentInfo[vi].star}${vv[0][1]}(${vv[0][0]}) ${vv[1].join('->')}  ` + vv[2].map(point => `(${point.map(p => p.toFixed()).join(",")})`).join("---")
                    ).join("\n"),
                imagePath: gacha.pointsFileName,
                channelId: sendAccuseGachaInfoChannel,
            });
            const studentInfo3star = studentInfo.filter(v => v.star == 3);
            // log.debug(studentInfo3star.map(v => v.name[0]));
            if (!studentInfo3star.length) continue;
            total3star += studentInfo3star.length;

            //惨 鼠八堇 惨
            const notMiserable = studentInfo3star.find(v => !miserableNames.includes(v.devName));
            // log.debug(notMiserable);
            if (!notMiserable) isMiserable = true;
        }

        await client.messageApi.deleteMessage(srcMsg.channel_id, srcMsg.id);
        if (isMiserable) return msg.sendMsgExRef({ content: `惨 鼠八堇 惨` });

        // const muteTime = 60 * 60 * 24 * total3star;
        const muteTime = 60 * 60 * 24 * 0.5;
        await client.muteApi.muteMember(srcMsg.guild_id, srcMsg.author.id, { seconds: muteTime.toString(), });

        await redis.hSet(`mute:${srcMsg.author.id}`, new Date().getTime(), "accuseGacha");
        await redis.hGetAll(`mute:${srcMsg.author.id}`).then(async muteInfo => {
            const f = (ts: string) => format.asString(new Date(Number(ts)));
            const t = async (type: string) => (await redis.hGet("muteType", type) || type);
            const s = Object.keys(muteInfo).map(async ts => `时间: ${f(ts)} | 类型: ${await t(muteInfo[ts])}`);
            return Promise.all(s);
        }).then(m => msg.sendMsgExRef({
            content: ["禁言记录", ...m].join("\n"),
        }));
        await msg.sendMsgEx({
            content: `<@${srcMsg.author.id}>(id: ${srcMsg.author.id})` +
                `\n禁言${(muteTime / 60 / 60)}小时` +
                `\n原因: 被举报晒卡` +
                `\n子频道: <#${srcMsg.channel_id}>(id: ${srcMsg.channel_id})` +
                `\n举报人: <@${msg.author.id}>(id: ${msg.author.id})` +
                `\n注意: 该消息由举报人进行举报, 并由bot自动检测出存在晒卡行为, 如有误判或异议请联系举报人与<@${adminId[0]}>` +
                `\n(该步骤为初步操作, 若无后续则以本次为准)`,
            channelId: await redis.hGet("mute:sendChannel", msg.guild_id),
        });

    } catch (err) {
        isChecking = false;
        log.error(err);
        await msg.sendMsgExRef({ content: `检测过程中出现了一些问题 <@${adminId[0]}>\n${JSON.stringify(err).replaceAll(".", "。")}` });
    }
    isChecking = false;
}

async function accuseGachaWapper(srcMsg: IMessageGUILD) {
    const total = [];

    for (const attachment of srcMsg.attachments!) {
        const ts = new Date().getTime();
        const srcFileName = `${config.imagesOut}/gc_${ts}_src.jpg`;
        const pointsFileName = `${config.imagesOut}/gc_${ts}_points.jpg`;

        await fetch("https://" + attachment.url).then(res => res.buffer()).then(buff => fs.writeFileSync(srcFileName, buff));
        const gachaInfo: [(string | [string, string]), number[], [number, number][], [number, number][], number][] = await PythonShell.run(`${config.extractRoot}/gachaRecognition.py`, {
            pythonPath: "/usr/bin/python3.11",
            args: [
                "--big-file-path", srcFileName,
                "--small-images-path", config.images.accuseCharacters,
                "--json", "true",
                "--save-path", pointsFileName,
            ],
        }).then(res => JSON.parse(res[0]));

        // const sendMsg = ["已找到:"];
        var possibleTotal = 0;
        var has3star = false;
        for (const [i, e] of gachaInfo.entries()) {
            const name = (e[0] as string).replace("Student_Portrait_", "");
            const info = Object.values(studentInfo).find(v => v.devName == name ? v : null);
            if (!info) throw `未找到 ${name} 对应数据`;
            if (info.star == 3) has3star = true;
            possibleTotal += Math.min(...e[1]);
            e[0] = [name, info.name[0]];
            e.push(info as any);
            gachaInfo[i] = e;
        }
        total.push({ gachaInfo, pointsFileName, possibleTotal });
        // await msg.sendMsgEx({ content: sendMsg.join("\n"), ref: true, });
        // log.debug(gachaInfo);
    }
    isChecking = false;
    return total;
}

export async function avalonSystem(msg: IMessageGUILD) {
    return avalonSystemWatcher(msg).then(() => {
        if (msg.channel_id == "43227251") return meituChannel(msg);
    });
}

export async function avalonSystemWatcher(msg: IMessageGUILD) {
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${msg.author.id}`);
    if (!watchChannel) return;

    return msg.sendMsgEx({
        content: `来源子频道: ${msg.channelName}` +
            `\n来源子频道id: ${msg.channel_id}` +
            `\n内容${msg._atta}: \n` +
            msg.content.replaceAll(".", ". "),
        imageUrl: msg.attachments ? "http://" + msg.attachments[0].url : undefined,
        channelId: watchChannel,
    }).catch(err => sendToAdmin(JSON.stringify(err).replaceAll(".", "。")));
}

export async function addWatchList(msg: IMessageGUILD | IMessageDIRECT) {
    if (unauthorized(msg)) return;
    const reg = /^watch\s*(\d*)$/.exec(msg.content)!;
    const watchUser = reg[1];
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${watchUser}`);

    return client.guildApi.guildMember("7487571598174764531", watchUser).then(res => {
        const { data } = res;
        if (watchChannel) return msg.sendMsgEx({
            content: `阿瓦隆监控列表已存在` +
                `\nnick: ${data.nick}` +
                `\nusername: ${data.user.username}` +
                `\nid: ${data.user.id}`,
        });
        return client.channelApi.postChannel("13281105882878427654", {
            name: `${watchUser}-${data.nick}`,
            type: 0,
            parent_id: "535627915",
            position: 0,
        }).then(r => redis.hSet(`AvalonSystem`, `watchChannel:${data.user.id}`, r.data.id)).then(() => msg.sendMsgEx({
            content: `已添加用户到阿瓦隆监控列表` +
                `\nnick: ${data.nick}` +
                `\nusername: ${data.user.username}` +
                `\nid: ${data.user.id}`,
        }));
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({
            content: `发送消息时出现了错误`
                + `\n${JSON.stringify(err).replaceAll(".", " .")}`,
        });
    });
}

export async function unWatchList(msg: IMessageGUILD | IMessageGUILD) {
    if (unauthorized(msg)) return;
    const reg = /^unwatch\s*(\d*)$/.exec(msg.content)!;
    const watchUser = reg[1];
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${watchUser}`);

    return redis.hDel(`AvalonSystem`, `watchChannel:${watchUser}`).then(status => {
        // saveGuildsTree["13281105882878427654"].channels
        if (!watchChannel) return msg.sendMsgEx({
            content: `数据库中未找到监控室子频道` +
                `\nstatus: ${status}`,
        });
        return client.channelApi.deleteChannel(watchChannel).then(res => msg.sendMsgEx({
            content: `已删除监控室子频道` +
                `\nstatus: ${status}` +
                `\ndata: ${JSON.stringify(res.data)}`
        }));
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({
            content: `发送消息时出现了错误`
                + `\n${JSON.stringify(err).replaceAll(".", " .")}`,
        });
    });

}

// export async function listWatchList(msg:IMessageGUILD|IMessageDIRECT) {
//     if(unauthorized(msg))return;

// }

function unauthorized(msg: IMessageGUILD | IMessageDIRECT) {
    return !((msg.messageType == "DIRECT" && adminId.includes(msg.author.id)) || msg.channel_id == "519695851");
}

export async function meituChannel(msg: IMessageGUILD) {
    if (devEnv) return;
    if (msg.content == "当前版本不支持查看，请升级QQ版本") return;
    if (msg.content == "当前版本不支持该消息类型，请使用最新版本手机QQ查看") return;
    if (msg.attachments) return;
    if (msg.member && msg.member.roles && (msg.member.roles.includes("2") || msg.member.roles.includes("4") || msg.member.roles.includes("5"))) return;

    const sendToChannel = await redis.hGet("mute:sendChannel", msg.guild_id);

    return msg.sendMsgEx({
        content: `发现无图文字` +
            `\n用户: ${msg.author.username}(${msg.author.id})` +
            `\n内容: ${msg.content}` +
            `\n原因: 无图文字`,
        guildId: await global.redis.hGet(`directUid->Gid`, adminId[0]),
        sendType: "DIRECT",
    }).then(() => client.muteApi.muteMember(msg.guild_id, msg.author.id, { seconds: String(1 * 60 * 60) })
    ).then(() => client.messageApi.deleteMessage(msg.channel_id, msg.id)
    ).then(() => sendToChannel ? msg.sendMsgEx({
        content: `<@${msg.author.id}>(id: ${msg.author.id})` +
            `\n禁言1h` +
            `\n原因: 无配图文字` +
            `\n注意: 该消息由bot自动发送，如有异议联系<@${adminId[0]}>`,
        channelId: sendToChannel,
        sendType: "GUILD",
    }) : undefined
    ).catch(err => {
        log.error(err);
    });
}
