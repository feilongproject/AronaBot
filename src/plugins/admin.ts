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

function timeConver(time: number) {
    time /= 1000;
    if (time < 60) {
        return "不足1分钟";
    }
    time /= 60;
    time = parseInt(time.toFixed(0));
    const m = time % 60;
    if (time < 60) return `${m}分钟`;
    time /= 60;
    time = parseInt(time.toFixed(0));
    return `${time}小时${m}分钟`;
}
