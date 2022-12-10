import os from "os";
import child_process from "child_process";
import { IMessageDIRECT } from "../libs/IMessageEx";
import { IUser } from "qq-guild-bot";


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
    return msg.sendMsgEx({
        content
    });
}

export async function ping(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    msg.sendMsgEx({ content: await global.redis.ping() });
}

export async function hotLoad(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    const type = /^\/?(开启|关闭)热(加载|更新)$/.exec(msg.content)![1];
    hotLoadStatus = type.includes("开") ? true : false;
    return msg.sendMsgEx({
        content: `已${msg.content}`,
    });
}

export async function mute(msg: IMessageDIRECT) {
    const author = msg.member;
    if (!author || !author.roles || !(author.roles.includes("2") || author.roles.includes("4") || author.roles.includes("5"))) return;

    const timeExec = /禁言(\d+)((分钟?|m)|(小?时|h)|(天|d))/.exec(msg.content)!;
    log.debug(timeExec[1], timeExec[2], timeExec[3], timeExec[4], timeExec[5],);
    const muteTime = Number(timeExec[1]) * (timeExec[3] ? 60 : timeExec[4] ? 60 * 60 : 60 * 60 * 24);

    var muteMember: IUser | null = null;
    for (const mention of (msg.mentions || [])) if (!mention.bot) muteMember = mention;
    if (!muteMember) return msg.sendMsgEx({ content: `未指定禁言对象` });
    if (msg.author.id == muteMember.id) return msg.sendMsgExRef({ content: "禁止禁言自己" });

    const alart = await client.guildApi.guildMember(msg.guild_id, muteMember.id).then(res => {
        const { data } = res;
        if (!data.roles || !data.roles) return null;
        const _roles = data.roles;
        if (_roles.includes("4")) return "无法禁言频道主";
        if (_roles.includes("2")) return "无法禁言绿管";
        return null;
    });
    if (alart) return msg.sendMsgExRef({ content: alart });

    return client.muteApi.muteMember(msg.guild_id, muteMember.id, { seconds: muteTime.toString() }).then(() => {
        if (muteTime == 0) return msg.sendMsgExRef({ content: `已解除禁言` });
        else return msg.sendMsgExRef({ content: `已对成员<@${muteMember?.id}>禁言${timeConver(muteTime * 1000)}`, });
    }).then(async () => {
        return msg.sendMsgEx({
            content: `管理执行禁言权限` +
                `\n权限：${JSON.stringify(msg?.member?.roles)}` +
                `\n管理：${msg.author.username}(${msg.author.id})` +
                `\n目标：${muteMember?.username}(${muteMember?.id})` +
                `\n频道：${msg.guild_name}(${msg.guild_id})` +
                `\n子频道：${msg.channel_name}(${msg.channel_id})` +
                `\n时间：${timeConver(muteTime * 1000)}`,
            guildId: await global.redis.hGet(`directUid->Gid`, adminId[0]),
            sendType: "DIRECT",
        });
    }).catch(err => {
        log.error(err);
        msg.sendMsgEx({ content: JSON.stringify(err) });
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
            return msg.sendMsgEx({
                content: `消息已发送`,
            });
        });
    }

    return msg.sendMsgEx({
        content: `用户：${msg.author.username}发送了一条信息` +
            `\n用户id：${msg.author.id}` +
            `\n源频道：${msg.src_guild_id}` +
            `\n内容：${msg.content}`,
        guildId: await global.redis.hGet(`directUid->Gid`, adminId[0]),
    }).then((m: any) => {
        return redis.hSet(`directMid->Gid`, m.data.id, msg.guild_id);
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

    return `${ms ? `${ms}天 ` : ``} ${h ? `${h}小时 ` : ``}${m ? `${m}分钟 ` : ``}`;
}