import fs from 'fs';
import fetch from 'node-fetch';
import format from 'date-format';
import { PythonShell } from 'python-shell';
import { sendToAdmin } from '../libs/common';
import {
    IMessageGUILD,
    IMessageDIRECT,
    MessageType,
    IMessageGROUP,
    IMessageC2C,
} from '../libs/IMessageEx';
import config from '../../config/config';

var isChecking = false;

export async function accuseGacha(msg: IMessageGUILD) {
    if (await redis.sIsMember(`mute:doNotMute`, msg.channel_id))
        return msg.sendMsgExRef({ content: '要不先看看子频道名字？' });
    if (!msg.message_reference) return msg.sendMsgExRef({ content: `未指定引用信息` });
    if (isChecking) return msg.sendMsgExRef({ content: `当前队列中存在正在检测的图片, 请稍候` });

    const srcMsg = await client.messageApi
        .message(msg.channel_id, msg.message_reference!.message_id)
        .then(
            (data) =>
                new IMessageGUILD({ ...data.data.message, seq: 0, seq_in_channel: '' }, false),
        );
    if (!srcMsg.attachments) return msg.sendMsgEx({ content: '引用消息中不存在图片信息' });

    await sendToAdmin(
        `accuseGacha触发` +
            `\n子频道: ${msg.channelName}(${msg.channel_id})` +
            `\n目标: ${srcMsg.author.username}(${srcMsg.author.id})` +
            `\n举报人: ${msg.author.username}(${msg.author.id})`,
    );
    const muteLogChannel = await redis.hGet('mute:logChannel', msg.guild_id);
    if (!muteLogChannel) return msg.sendMsgExRef({ content: '未指定muteLog发送子频道' });
    const ruleChannel = await redis.hGet('mute:ruleChannel', msg.guild_id);
    if (!ruleChannel) return msg.sendMsgExRef({ content: `未指定频规子频道` });

    try {
        isChecking = true;
        await msg.sendMsgExRef({
            content:
                `正在检测中...` +
                `\n注意: 该步骤会对服务器CPU与内存资源造成大量消耗, 若无意义使用(指对明显没有三星的图片使用)或恶意使用, 可能会导致但不限于无法使用bot任何功能/被禁言等, 具体规定请看<#${ruleChannel}>子频道`,
        });
        const gachaInfo = await accuseGachaWapper(srcMsg);
        isChecking = false;
        if (!gachaInfo.map((v) => v.possibleTotal).reduce((a, b) => a + b)) {
            for (const [i, attachment] of srcMsg.attachments.entries()) {
                await msg.sendMsgEx({
                    content:
                        `子频道: <#${msg.channel_id}>(${msg.channel_id})` +
                        `\n目标: ${srcMsg.author.username}(${srcMsg.author.id})` +
                        `\n举报人: ${msg.author.username}(${msg.author.id})` +
                        `\n第${i + 1}张图未匹配到角色特征`,
                    imageUrl: 'http://' + attachment.url,
                    channelId: muteLogChannel,
                });
            } // 发送原图
            return msg.sendMsgExRef({ content: `opencv 未匹配到角色特征 <@${adminId[0]}>` });
        } // 未匹配到任何特征

        if (!gachaInfo.find((v) => v.has3star)) {
            for (const [i, gacha] of gachaInfo.entries()) {
                // log.debug(gacha);
                await msg.sendMsgEx({
                    content:
                        `子频道: <#${msg.channel_id}>(${msg.channel_id})` +
                        `\n目标: ${srcMsg.author.username}(${srcMsg.author.id})` +
                        `\n举报人: ${msg.author.username}(${msg.author.id})` +
                        `\n第${i + 1}张图未找到三星(${gacha.possibleTotal}): lang-${gacha.gachaInfo.firstChecker.length}\n` +
                        gacha.gachaInfo.firstChecker
                            .map(
                                (v) =>
                                    `${v[0]}->${v[1]} (${v[2].map((vv) => vv.toFixed()).join(',')})`,
                            )
                            .join('\n') +
                        `\n` +
                        gacha.gachaInfo.main
                            .map(
                                (vv, vi) =>
                                    `${vv.studentData.star}${vv.nameCn}(${vv.nameDev}) ${vv.possible.join('->')}  ` +
                                    vv.center
                                        .map(
                                            (point) =>
                                                `(${point.map((p) => p.toFixed()).join(',')})`,
                                        )
                                        .join('---'),
                            )
                            .join('\n'),

                    imagePath: gacha.pointsFileName,
                    channelId: muteLogChannel,
                });
            } // 发送点集图
            return msg.sendMsgExRef({ content: `未找到三星 <@${adminId[0]}>` });
        } // 未找到三星

        // await msg.sendMsgExRef({ content: "存在角色特征, 继续执行" });
        // log.debug("存在角色特征, 继续执行");
        var total3star = 0;
        var has3star = 0; // 存在3star的图片数量
        const miserableNames = ['Saya', 'Izumi', 'Sumire', 'Saya_Casual']; // 鼠 八 堇 便服鼠
        var isMiserable = 0;
        for (const [i, gacha] of gachaInfo.entries()) {
            // const studentInfo: StudentInfo[] = gacha.gachaInfo.main.map(v => v.pop()) as any;
            await msg.sendMsgEx({
                content:
                    `子频道: <#${msg.channel_id}>(${msg.channel_id})` +
                    `\n目标: ${srcMsg.author.username}(${srcMsg.author.id})` +
                    `\n举报人: ${msg.author.username}(${msg.author.id})` +
                    `\n第${i + 1}张图检测统计(${gacha.possibleTotal}): ${gacha.gachaInfo.firstChecker.length}lang\n` +
                    gacha.gachaInfo.firstChecker
                        .map(
                            (v) => `${v[0]}->${v[1]} (${v[2].map((vv) => vv.toFixed()).join(',')})`,
                        )
                        .join('\n') +
                    `\n` +
                    gacha.gachaInfo.main
                        .map(
                            (vv, vi) =>
                                `${vv.studentData.star}${vv.nameCn}(${vv.nameDev}) ${vv.possible.join('->')}  ` +
                                vv.center
                                    .map((point) => `(${point.map((p) => p.toFixed()).join(',')})`)
                                    .join('---'),
                        )
                        .join('\n'),
                imagePath: gacha.pointsFileName,
                channelId: muteLogChannel,
            });
            const studentInfo3star = gacha.gachaInfo.main.filter((vv) => vv.studentData.star == 3);
            // log.debug(studentInfo3star.map(v => v.name[0]));
            if (!studentInfo3star.length) continue;
            has3star++;
            total3star += studentInfo3star.length;

            //惨 鼠八堇 惨
            const notMiserable = studentInfo3star.find((v) => !miserableNames.includes(v.nameDev));
            // log.debug(notMiserable);
            if (!notMiserable) isMiserable++;
        } // 发送日志

        if (!gachaInfo.find((v) => v.gachaInfo.firstChecker.length)) {
            return msg.sendMsgExRef({
                content: `未匹配到抽卡图标志, 当前支持: ${fs
                    .readdirSync(config.images.firstChecker)
                    .map((n) => n.replace('.png', ''))
                    .join(',')}`,
            });
        } // 不存在 firstChecker

        await client.messageApi.deleteMessage(srcMsg.channel_id, srcMsg.id);
        if (isMiserable == has3star) return msg.sendMsgExRef({ content: `惨 鼠八堇 惨` });
        // else if (isMiserable)await msg.sendMsgExRef()

        // const muteTime = 60 * 60 * 24 * total3star;
        const muteTime = 60 * 60 * 24 * 0.5;
        await client.muteApi.muteMember(srcMsg.guild_id, srcMsg.author.id, {
            seconds: muteTime.toString(),
        });

        await redis.hSet(`mute:${srcMsg.author.id}`, new Date().getTime(), 'accuseGacha');
        await redis
            .hGetAll(`mute:${srcMsg.author.id}`)
            .then(async (muteInfo) => {
                const f = (ts: string) => format.asString(new Date(Number(ts)));
                const t = async (type: string) => (await redis.hGet('muteType', type)) || type;
                const s = Object.keys(muteInfo).map(
                    async (ts) => `时间: ${f(ts)} | 类型: ${await t(muteInfo[ts])}`,
                );
                return Promise.all(s);
            })
            .then((m) =>
                msg.sendMsgExRef({
                    content: ['禁言记录', ...m].join('\n'),
                }),
            ); // 发送禁言记录
        await msg.sendMsgEx({
            channelId: (await redis.hGet('mute:sendChannel', msg.guild_id)) ?? undefined,
            content:
                `<@${srcMsg.author.id}>(id: ${srcMsg.author.id})` +
                `\n禁言${muteTime / 60 / 60}小时` +
                `\n原因: 被举报晒卡` +
                `\n子频道: <#${srcMsg.channel_id}>(id: ${srcMsg.channel_id})` +
                `\n举报人: <@${msg.author.id}>(id: ${msg.author.id})` +
                `\n注意: 该消息由举报人进行举报, 并由bot自动检测出存在晒卡行为, 如有误判或异议请联系举报人与<@${adminId[0]}>` +
                `\n(该步骤为初步操作, 若无后续则以本次为准)`,
        }); // 发送小黑屋
    } catch (err: any) {
        isChecking = false;
        log.error(err);
        if (err?.code == 306004)
            return msg.sendMsgExRef({ content: `没有权限删除！请检查禁言对象权限` });
        return msg.sendMsgExRef({
            content: `检测过程中出现了一些问题 <@${adminId[0]}>\n${(typeof err == 'object' ? JSON.stringify(err) : String(err)).replaceAll('.', ',')}`,
        });
    }
}

async function accuseGachaWapper(srcMsg: IMessageGUILD) {
    const total = [];
    for (const attachment of srcMsg.attachments!) {
        const ts = new Date().getTime();
        const srcFileName = `${config.imagesOut}/gc_${ts}_src.jpg`;
        const pointsFileName = `${config.imagesOut}/gc_${ts}_points.jpg`;

        await fetch('https://' + attachment.url)
            .then((res) => res.buffer())
            .then((buff) => fs.writeFileSync(srcFileName, buff));
        const gachaInfo: PythonGachaInfo = await PythonShell.run(
            `${config.extractRoot}/gachaRecognition.py`,
            {
                pythonPath: '/usr/bin/python3.11',
                args: [
                    '--big-file-path',
                    srcFileName,
                    '--small-images-path',
                    config.images.accuseCharacters,
                    '--json',
                    'true',
                    '--save-path',
                    pointsFileName,
                    '--first-checkers-path',
                    config.images.firstChecker,
                ],
            },
        ).then((res) => JSON.parse(res.pop()));

        // const sendMsg = ["已找到:"];
        var possibleTotal = 0;
        var has3star = false;
        for (const [i, e] of gachaInfo.main.entries()) {
            e.nameDev = e.nameDev.replace('Student_Portrait_', '');
            const info = Object.values(studentInfo).find((v) =>
                v.devName == e.nameDev ? v : null,
            );
            if (!info) throw `未找到 ${e.nameDev} 对应数据`;
            if (info.star == 3) has3star = true;
            possibleTotal += Math.min(...e.possible);
            e.nameCn = info.name[0];
            e.studentData = info;
            gachaInfo.main[i] = e;
        }
        total.push({ gachaInfo, pointsFileName, possibleTotal, has3star });
        // await msg.sendMsgEx({ content: sendMsg.join("\n"), ref: true, });
        // log.debug(gachaInfo);
    }
    return total;
}

export async function accuseGachaUpdate(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
) {
    if (!adminId.includes(msg.author.id)) return;
    const _dbImageList = await fetch('https://schaledb.com/data/cn/students.min.json')
        .then((res) => res.json())
        .then((students: Record<string, StudentDataNet>) =>
            Object.values(students).map((v) => v.DevName),
        );
    const _extractImageList = await fetch(
        'https://ghproxy.net/https://raw.githubusercontent.com/electricgoat/ba-data/jp/Excel/CharacterExcelTable.json',
    )
        .then((res) => res.json())
        .then((json) =>
            (json.DataList as any[])
                .filter(
                    (v) =>
                        v.TacticEntityType == 'Student' &&
                        v.ProductionStep == 'Release' &&
                        v.IsPlayableCharacter,
                )
                .map((v) => (v.DevName as string).replace(/_default$/, '')),
        );
    const studentList = [..._dbImageList, ..._extractImageList]
        .map((v) => v[0].toUpperCase() + v.substring(1))
        .filter((item, index, arr) => arr.indexOf(item, 0) === index);

    if (!fs.existsSync(config.images.accuseCharacters))
        fs.mkdirSync(config.images.accuseCharacters);
    // const localAllImages = fs.readdirSync(config.images.characters)
    //     .filter(v => v.startsWith("Student_Portrait_"))
    //     .map(v => v.replace(/Student_Portrait_(.*)\.png/, "$1"));
    const localList = fs
        .readdirSync(config.images.accuseCharacters)
        .filter((v) => v.startsWith('Student_Portrait_'))
        .map((v) => v.replace(/Student_Portrait_(.*)\.png/, '$1'));

    const notFoundStudent = studentList.filter(
        (v) => !fs.existsSync(`${config.images.characters}/Student_Portrait_${v}.png`),
    );
    if (notFoundStudent.length)
        return msg.sendMsgEx({
            content: `全局图库中: ${notFoundStudent.map((v) => 'Student_Portrait_' + v)} 不存在`,
        });

    const notFoundRemote = localList.filter((v) => !studentList.includes(v));
    if (notFoundRemote.length)
        return msg.sendMsgEx({ content: `晒卡禁言图库中: ${notFoundRemote} 在远程不存在` });

    const notFoundAccuseImage = studentList.filter(
        (v) => !fs.existsSync(`${config.images.accuseCharacters}/Student_Portrait_${v}.png`),
    );
    if (notFoundAccuseImage.length) {
        await msg.sendMsgEx({
            content: `晒卡禁言图库中: ${notFoundAccuseImage.map((v) => 'Student_Portrait_' + v)} 未找到，正在从全局图库中复制`,
        });
        for (const v of notFoundAccuseImage) {
            try {
                fs.copyFileSync(
                    `${config.images.characters}/Student_Portrait_${v}.png`,
                    `${config.images.accuseCharacters}/Student_Portrait_${v}.png`,
                );
            } catch (err) {
                return msg.sendMsgEx({
                    content: `移动文件时出了一些问题\n${JSON.stringify(err).replaceAll('.', ',')}`,
                });
            }
        }
        await msg.sendMsgEx({ content: `所有文件全部移动成功` });
    } else {
        await msg.sendMsgEx({ content: `所有文件已存在` });
    }
}

export async function avalonSystem(msg: IMessageGUILD) {
    await redis.hSet('nameLink', msg.author.username, msg.author.id);
    return avalonSystemWatcher(msg).then(() => {
        if (msg.channel_id == '43227251') return meituChannel(msg);
    });
}

export async function avalonSystemWatcher(msg: IMessageGUILD) {
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${msg.author.id}`);
    if (!watchChannel) return;

    return msg
        .sendMsgEx({
            content:
                `来源子频道: ${msg.channelName}(${msg.channel_id})` +
                `\n名称: ${msg.author.username}(${msg.member.nick})` +
                `\n内容 ${msg._atta} : \n` +
                msg.content.replaceAll('.', ','),
            imageUrl: msg.attachments ? 'http://' + msg.attachments[0].url : undefined,
            channelId: watchChannel,
        })
        .catch((err) =>
            sendToAdmin(
                `avalonSystemWatcher 错误` +
                    `\n${msg.author.username}(${msg.author.id})` +
                    `\n来源子频道: ${msg.channelName}(${msg.channel_id})\n` +
                    JSON.stringify(err).replaceAll('.', '。'),
            ),
        );
}

export async function addWatchList(msg: IMessageGUILD) {
    if (unauthorized(msg)) return;
    const reg = /^阿瓦隆添加\s*(\d*)$/.exec(msg.content)!;
    const watchUser = reg[1];
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${watchUser}`);

    return client.guildApi
        .guildMember('7487571598174764531', watchUser)
        .then((res) => {
            const { data } = res;
            if (watchChannel)
                return msg.sendMsgEx({
                    content:
                        `阿瓦隆监控列表已存在` +
                        `\nnick: ${data.nick}` +
                        `\nusername: ${data.user.username}` +
                        `\nid: ${data.user.id}`,
                });
            return client.channelApi
                .postChannel('13281105882878427654', {
                    name: `${watchUser}-${data.nick}`,
                    type: 0,
                    parent_id: '535627915',
                    position: 0,
                })
                .then((r) => redis.hSet(`AvalonSystem`, `watchChannel:${data.user.id}`, r.data.id))
                .then(() =>
                    msg.sendMsgEx({
                        content:
                            `已添加用户到阿瓦隆监控列表` +
                            `\nnick: ${data.nick}` +
                            `\nusername: ${data.user.username}` +
                            `\nid: ${data.user.id}`,
                    }),
                );
        })
        .catch((err) => {
            log.error(err);
            return msg.sendMsgEx({
                content: `发送消息时出现了错误` + `\n${JSON.stringify(err).replaceAll('.', ' .')}`,
            });
        });
}

export async function unWatchList(msg: IMessageGUILD) {
    if (unauthorized(msg)) return;
    const reg = /^阿瓦隆删除\s*(\d*)$/.exec(msg.content)!;
    const watchUser = reg[1];
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${watchUser}`);

    return redis
        .hDel(`AvalonSystem`, `watchChannel:${watchUser}`)
        .then((status) => {
            // saveGuildsTree["13281105882878427654"].channels
            if (!watchChannel)
                return msg.sendMsgEx({
                    content: `数据库中未找到监控室子频道` + `\nstatus: ${status}`,
                });
            return client.channelApi.deleteChannel(watchChannel).then((res) =>
                msg.sendMsgEx({
                    content:
                        `已删除监控室子频道` +
                        `\nstatus: ${status}` +
                        `\ndata: ${JSON.stringify(res.data)}`,
                }),
            );
        })
        .catch((err) => {
            log.error(err);
            return msg.sendMsgEx({
                content: `发送消息时出现了错误` + `\n${JSON.stringify(err).replaceAll('.', ' .')}`,
            });
        });
}

export async function searchMembers(msg: IMessageGUILD | IMessageDIRECT) {
    const match = /^\/?阿瓦隆搜索(\d*)\s+(.*)/.exec(msg.content);
    if (!match || !match[2])
        return msg.sendMsgEx({ content: `未找到搜索内容，请在命令与搜索中间加入空格` });
    const searchStr = match[2];
    const max = Number(match[1]) || 10;
    const ret: string[] = [];
    let now = 0;

    for await (const it of redis.hScanIterator('nameLink', { MATCH: `*${searchStr}*` })) {
        if (now >= max) break;
        const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${it.value}`);
        ret.push(`${it.field}(${it.value})${watchChannel ? ` 已存在于 ${watchChannel}` : ''}`);
        now++;
    }

    return msg.sendMsgExRef({
        content: ret.length ? `阿瓦隆搜索结果：\n` + ret.join('\n') : '未搜索到任何结果',
    });
}

// export async function listWatchList(msg:IMessageGUILD|IMessageDIRECT) {
//     if(unauthorized(msg))return;

// }

function unauthorized(msg: IMessageGUILD | IMessageDIRECT) {
    return !(
        (msg.messageType == MessageType.DIRECT && adminId.includes(msg.author.id)) ||
        msg.channel_id == '519695851'
    );
}

export async function meituChannel(msg: IMessageGUILD) {
    if (devEnv) return;
    if (msg.content == '当前版本不支持查看，请升级QQ版本') return;
    if (msg.content == '当前版本不支持该消息类型，请使用最新版本手机QQ查看') return;
    if (msg.attachments) return;
    if (
        msg.member &&
        msg.member.roles &&
        (msg.member.roles.includes('2') ||
            msg.member.roles.includes('4') ||
            msg.member.roles.includes('5'))
    )
        return;

    const sendToChannel = await redis.hGet('mute:sendChannel', msg.guild_id);

    return sendToAdmin(
        `发现无图文字` +
            `\n用户: ${msg.author.username}(${msg.author.id})` +
            `\n内容: ${msg.content}` +
            `\n原因: 无图文字`,
    )
        .then(() =>
            client.muteApi.muteMember(msg.guild_id, msg.author.id, {
                seconds: String(1 * 60 * 60),
            }),
        )
        .then(() => client.messageApi.deleteMessage(msg.channel_id, msg.id))
        .then(() =>
            sendToChannel
                ? msg.sendMsgEx({
                      content:
                          `<@${msg.author.id}>(id: ${msg.author.id})` +
                          `\n禁言1h` +
                          `\n原因: 无配图文字` +
                          `\n注意: 该消息由bot自动发送，如有异议联系<@${adminId[0]}>`,
                      channelId: sendToChannel,
                      sendType: MessageType.GUILD,
                  })
                : undefined,
        )
        .catch((err) => {
            log.error(err);
        });
}

interface PythonGachaInfo {
    firstChecker: [
        string, // 语言名字
        number, // 匹配到的特征点数量
        [number, number], // 中心坐标
    ][];
    main: {
        nameDev: string;
        nameCn: string;
        possible: [number, number]; // possible possible_ed
        center: [number, number][]; // 中心坐标
        studentData: StudentData; //学生数据
    }[]; //多个匹配, 一般长度为10
}
