import os from 'os';
import fs from 'fs';
import qr from 'qr-image';
import Excel from 'exceljs';
import child_process from 'child_process';
import { sendToAdmin, timeConver } from '../libs/common';
import { IMessageC2C, IMessageDIRECT, IMessageGROUP, IMessageGUILD } from '../libs/IMessageEx';
import config from '../../config/config';

export async function updateEventId(event?: IntentMessage.GUILD_MEMBERS) {
    const opUserId = '15874984758683127001';
    if (devEnv) log.debug('updateEventId', event?.eventId);
    if (event?.msg.user.id == opUserId) {
        return redis.setEx(`lastestEventId:${meId}:${event.msg.guild_id}`, 60 * 4, event.eventId);
    }
    if (event) return;

    for (const guildId in saveGuildsTree) {
        const guildInfo = saveGuildsTree[guildId];
        const channel = Object.values(guildInfo.channels).find((v) => v.name == 'bot操作记录日志');
        if (!channel) continue;
        if (devEnv && guildId != '2175103623165659414') continue;

        await client.memberApi
            .memberAddRole(guildId, '5', opUserId, channel.id)
            .then((res) => {
                if (devEnv) log.debug('memberAddRole', res.status, res.statusText);
            })
            .catch((err) => {
                log.error(err);
                return sendToAdmin(
                    `updateEventId memberAddRole` +
                        `\n${strFormat({ err, guild: guildInfo })}`.replaceAll('.', ','),
                ).catch((err) => log.error(err));
            });
    }
}

export async function status(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {
    if (!adminId.includes(msg.author.id)) return;
    const content =
        `------状态------` +
        `\n系统版本：${
            child_process
                .execSync('lsb_release -d')
                .toString()
                .split(/(\t|\n)/)[2]
        }` +
        `\n内核版本：${
            child_process
                .execSync('uname -a')
                .toString()
                .split(/(\t|\n|\ )/)[4]
        }` +
        `\n运行时间：${timeConver(new Date().getTime() - global.botStatus.startTime.getTime())}` +
        `\n发送消息：${global.botStatus.msgSendNum}条` +
        `\n生成图片：${global.botStatus.imageRenderNum}次` +
        `\n内存使用：${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)}MB` +
        `\n系统内存：${(os.freemem() / 1024 / 1024).toFixed()}MB/${(os.totalmem() / 1024 / 1024).toFixed()}MB (free/total)` +
        `\n系统已开机：${timeConver(os.uptime() * 1000)}`;
    if (devEnv) log.debug(`\n` + content);
    return msg.sendMsgEx(`\n${content}`);
}
export async function dmsMe(msg: IMessageGUILD) {
    const dmsInfo = await client.directMessageApi.createDirectMessage({
        source_guild_id: msg.guild_id,
        recipient_id: msg.author.id,
    });
    return client.directMessageApi.postDirectMessage(dmsInfo.data.guild_id, {
        content: 'pong',
        msg_id: msg.id,
    });
}

export async function ping(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {
    // if (!adminId.includes(msg.author.id)) return;
    // log.debug(msg);
    return msg.sendMsgEx(await global.redis.ping());
}

export async function hotLoad(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {
    if (!adminId.includes(msg.author.id))
        return !(msg instanceof IMessageGUILD)
            ? msg.sendMsgEx({ content: '无权限调用' })
            : undefined;
    // if (devEnv) return;
    const times = /\/?热(加载|更新)\s*(?<times>-?\d+)$/.exec(msg.content)?.groups?.times;
    hotLoadStatus = Number(times);
    return msg.sendMsgEx(`${devEnv} 已${msg.content}`);
}

export async function restart(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {
    if (!adminId.includes(msg.author.id)) return;
    await redis.set(`isRestart:${meId}`, 'T');
    await msg.sendMsgEx('开始重启');
    process.exit();
}

export async function sendTopMessage(msg: IMessageGUILD) {
    if (!adminId.includes(msg.author.id)) return;
    const match = /^\/?stm\s+(?<channelId>\d+)\s+(?<sendContent>.+)/s.exec(msg.content)?.groups;
    if (!match) return msg.sendMsgEx({ content: `channelId 或 content 为空` });
    const { channelId, sendContent } = match;
    const result = await msg.sendMsgEx({ channelId, content: sendContent });
    const msgId = result.result?.id;
    if (!msgId) throw new Error('sendTopMessage未找到msgId');

    return client.pinsMessageApi
        .putPinsMessage(channelId, msgId)
        .then(() => msg.sendMsgEx(`已发送消息至 ${channelId}`));
}

export async function directToAdmin(msg: IMessageDIRECT) {
    if (adminId.includes(msg.author.id)) {
        //log.debug(`refMid:${msg.message_reference?.message_id}`);
        const refMsgGid = await redis.hGet(
            `directMid->Gid`,
            msg.message_reference?.message_id || `0`,
        );
        //log.debug(refMsgGid);
        if (!refMsgGid) return;
        return msg
            .sendMsgEx({
                content: msg.content,
                guildId: refMsgGid,
            })
            .then(() => {
                return msg.sendMsgEx({ content: `消息已发送` });
            });
    }

    return msg
        .sendMsgEx({
            content:
                `用户：${msg.author.username}发送了一条信息` +
                `\n用户id：${msg.author.id}` +
                `\n源频道：${msg.src_guild_id}` +
                `\n内容：${msg.content}`,
            guildId: (await global.redis.hGet(`directUid->Gid:${meId}`, adminId[0])) ?? undefined,
        })
        .then((res) => {
            if (res?.result) return redis.hSet(`directMid->Gid`, res.result.id, msg.guild_id);
        });
}

export async function reloadStudentData(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
) {
    if (!adminId.includes(msg.author.id)) return;
    const type = /学生数据(网络|本地)重加载/.exec(msg.content)![1];
    return import('./studentInfo')
        .then((module) => module.reloadStudentInfo(type == '网络' ? 'net' : 'local'))
        .then((r) => msg.sendMsgExRef({ content: `已从${type}重加载资源并保存\n${r}` }))
        .catch((err) => {
            log.error(err);
            return msg.sendMsgExRef({ content: `${type}获取资源错误: ${err}` });
        });
}

export async function dumpChatRecord(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
) {
    if (!adminId.includes(msg.author.id)) return;

    const aid = /dump\s*(?<aid>\d+)/.exec(msg.content)?.groups?.aid;
    if (!aid) return msg.sendMsgEx({ content: `未指定id` });
    const fileName = `${aid}-${new Date().getTime()}.xlsx`;
    const _fileBuffer = await mariadb
        .query(
            'SELECT * FROM `guildMessage` WHERE `aid` = (?) ORDER BY `guildMessage`.`ts` ASC',
            aid,
        )
        .then((datas) => {
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
            return workbook.xlsx.writeBuffer();
        });
    const fileBuffer = Buffer.from(_fileBuffer);
    fs.writeFileSync(`${config.imagesOut}/${fileName}`, fileBuffer);
    await cosPutObject({
        Key: `record/${fileName}`,
        Body: fileBuffer,
        ContentLength: fileBuffer.length,
    });

    return msg.sendMsgEx({
        imageFile: qr.imageSync(cosUrl(`record/${fileName}`)),
        content: `用户 ${aid} 日志已转存\n${fileName}`,
    });
}
