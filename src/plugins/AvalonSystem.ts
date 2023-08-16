import fs from "fs";
import fetch from "node-fetch";
import { PythonShell } from "python-shell";
import { MessageAttachment } from "qq-guild-bot";
import { sendToAdmin } from "../libs/common";
import { IMessageGUILD, IMessageDIRECT } from "../libs/IMessageEx";
import config from "../../config/config.json";

const starString = ["☆☆☆", "★☆☆", "★★☆", "★★★"];
var isChecking = false;

export async function gachaCheck(msg: IMessageGUILD) {
    const roles = msg?.member?.roles || [];
    const allowRoles = ["11146065", "4", "2"];
    if (!roles.filter(v => allowRoles.includes(v)).length) return;


    try {
        if (isChecking) return msg.sendMsgExRef({ content: `当前队列中存在正在检测的图片, 请稍候` });

        await sendToAdmin(`管理正在gc\n管理:${msg.author.username}(${msg.author.id})`);

        const srcMsg = msg.message_reference?.message_id
            ? await client.messageApi
                .message(msg.channel_id, msg.message_reference?.message_id)
                .then(data => new IMessageGUILD({ ...data.data.message, seq: 0, seq_in_channel: "" }, false))
            : undefined;
        if (srcMsg && !srcMsg.attachments) return msg.sendMsgEx({ content: "引用消息中不存在图片信息" });
        else if (!srcMsg && !msg.attachments) return msg.sendMsgExRef({ content: "不存在图片信息" });

        isChecking = true;

        await msg.sendMsgExRef({ content: "正在检测中" });

        for (const attachment of (srcMsg || msg).attachments as MessageAttachment[]) {
            const fileName = `${config.imagesOut}/gc_${new Date().getTime()}.jpg`;
            await fetch("https://" + attachment.url).then(res => res.buffer()).then(buff => fs.writeFileSync(fileName, buff));

            const gachaInfo: { [key: string]: [string, number, number] } = await PythonShell.run(`${config.extractRoot}/gachaRecognition.py`, {
                pythonPath: "/usr/bin/python3.11",
                args: [
                    "--big-file-path", fileName,
                    "--small-images-path", config.images.characters,
                    "--json", "true"
                ],
            }).then(res => JSON.parse(res[0]));

            const sendMsg = ["已找到:"];
            var possibleTotal = 0;
            for (const key in gachaInfo) {
                const e = gachaInfo[key];
                const name = e[0].replace("Student_Portrait_", "");
                const info = Object.values(studentInfo).find(v => v.devName == name ? v : null);
                possibleTotal += Math.min(...[e[1], e[2]]);
                sendMsg.push(info ? `${starString[info?.star]} ${info.name[0]} 数量: ${e[1]} -> ${e[2]} ` : `${name} 未找到`);
            }
            sendMsg.push(`总计已找到: ${possibleTotal}`);
            await msg.sendMsgEx({ content: sendMsg.join("\n"), ref: true, });

            // log.debug(gachaInfo);
        }
    } catch (err) {
        await msg.sendMsgExRef({ content: `检测过程中出现了一些问题<@${adminId[0]}>\n${JSON.stringify(err).replaceAll(".", "。")}` });
    }

    isChecking = false;
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
