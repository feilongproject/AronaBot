import child_process from "child_process";
import os from "os";
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