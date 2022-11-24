import os from "os";
import child_process from "child_process";
import { IMessageEx } from "../libs/IMessageEx";

export async function status(msg: IMessageEx) {
    if (msg.author.id != adminId) return;
    return msg.sendMsgExRef({
        content: `------状态------` +
            `\n系统版本：${child_process.execSync("lsb_release -d").toString().split(/(\t|\n)/)[2]}` +
            `\n内核版本：${child_process.execSync("uname -a").toString().split(/(\t|\n|\ )/)[4]}` +
            `\n运行时间：${timeConver(new Date().getTime() - global.botStatus.startTime.getTime())}` +
            `\n发送消息：${global.botStatus.msgSendNum}条` +
            `\n生成图片：${global.botStatus.imageRenderNum}次` +
            `\n内存使用：${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)}MB` +
            `\n系统内存：${(os.freemem() / 1024 / 1024).toFixed()}MB/${(os.totalmem() / 1024 / 1024).toFixed()}MB (free/total)` +
            `\n系统已开机：${timeConver(os.uptime() * 1000)}`
    });
}

export async function ping(msg: IMessageEx) {
    if (msg.author.id != adminId) return;
    msg.sendMsgEx({ content: await global.redis.ping() });
}

export async function hotLoad(msg: IMessageEx) {
    if (msg.author.id != adminId) return;
    const type = /^\/?(开启|关闭)热(加载|更新)$/.exec(msg.content)![1];
    hotLoadStatus = type.includes("开") ? true : false;
    return msg.sendMsgEx({
        content: `已${msg.content}`,
    });
}

export async function mute(msg: IMessageEx) {
    const author = msg.member;
    if (!author || !author.roles || !(author.roles.includes("2") || author.roles.includes("4") || author.roles.includes("5"))) return;

    const muteMember = (msg.mentions || [])[0];
    const timeExec = /禁言(\d+)(分钟|小时|天)/.exec(msg.content)!;
    const muteTime = Number(timeExec[1]) * (timeExec[2].includes("分") ? 60 : timeExec[2].includes("时") ? 60 * 60 : 60 * 60 * 24);
    if (!muteMember) return msg.sendMsgEx({ content: `未指定禁言对象` });

    return client.muteApi.muteMember(msg.guild_id, muteMember.id, { seconds: muteTime.toString() }).then(() => {
        return msg.sendMsgExRef({
            content: `已对成员${muteMember.username}禁言${timeConver(muteTime * 1000)}`,
        });
    }).then(async () => {
        return msg.sendMsgEx({
            content: `管理执行禁言权限` +
                `\n权限：${JSON.stringify(msg?.member?.roles)}` +
                `\n管理：${msg.author.username}(${msg.author.id})` +
                `\n目标：${muteMember.username}(${muteMember.id})` +
                `\n子频道：${msg.guild_name}(${msg.guild_id})` +
                `\n时间：${timeConver(muteTime * 1000)}`,
            guildId: await global.redis.hGet(`directUid->Gid`, adminId),
            sendType: "DIRECT",
        });
    }).catch(err => {
        log.error(err);
        msg.sendMsgEx({ content: JSON.stringify(err), });
    });
}

export async function directToAdmin(msg: IMessageEx) {
    if (msg.author.id == adminId) {
        //log.debug(`refMid:${msg.message_reference?.message_id}`);
        const refMsgGid = await redis.hGet(`directMid->Gid`, msg.message_reference?.message_id || `0`);
        //log.debug(refMsgGid);
        if (!refMsgGid) return;
        return msg.sendMsgEx({
            content: msg.content,
            guildId: refMsgGid,
        });
    }

    return msg.sendMsgEx({
        content: `用户：${msg.author.username}发送了一条信息` +
            `\n用户id：${msg.author.id}` +
            `\n源频道：${msg.src_guild_id}` +
            `\n内容：${msg.content}`,
        guildId: await global.redis.hGet(`directUid->Gid`, adminId),
    }).then((m) => {
        return redis.hSet(`directMid->Gid`, m.data.id, msg.guild_id);
    });
}

function timeConver(ms: number) {
    ms = Number((ms / 1000).toFixed(0));
    if (ms < 60) return "不足1分钟";

    const s = ms % 60;
    ms = (ms - s) / 60;

    const m = ms % 60;
    ms = (ms - m) / 60;

    const h = ms % 24;
    ms = (ms - h) / 24;

    return `${ms ? `${ms}天 ` : ``} ${h ? `${h}小时 ` : ``}${m ? `${m}分钟 ` : ``}`;
}