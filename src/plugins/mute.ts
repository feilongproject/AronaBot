import format from "date-format";
import { IUser } from "qq-bot-sdk";
import { sendToAdmin, timeConver } from "../libs/common";
import { IMessageC2C, IMessageDIRECT, IMessageGROUP, IMessageGUILD } from "../libs/IMessageEx";


const execMap = [
    { t: "gacha", reg: /(抽卡|晒卡)/, del: true, send: true, },
    { t: "insulting", reg: /(龙图|辱骂|侮辱|攻击性?)/, del: true, send: true, },
    { t: "arguability", reg: /(有?争议性的?)/, del: true, send: true, },
];

export async function mute(msg: IMessageGUILD) {
    const roles = msg?.member?.roles || [];
    const allowRoles = [...await redis.sMembers(`allowRoles:mute:${msg.guild_id}`), "4", "2",];
    if (!roles.filter(v => allowRoles.includes(v)).length) return;

    const timeMatch = /(?<muteTime>\d+)((?<m>分钟?|m)|(?<h>小?时|h)|(?<d>天|d))/.exec(msg.content)?.groups;
    if (!timeMatch) return msg.sendMsgExRef({ content: `未指定禁言时间` });

    const muteTime = Number(timeMatch.muteTime) * (timeMatch.m ? 60 : (timeMatch.h ? 60 * 60 : 60 * 60 * 24));
    const cmdMatch = execMap.find(v => v.reg.exec(msg.content)) || { t: "common", reg: / /, del: false, send: false, desc: "普通" };

    var muteMember: IUser | null = null;
    for (const mention of (msg.mentions || [])) if (!mention.bot) muteMember = mention;
    if (!muteMember) return msg.sendMsgExRef({ content: `未指定禁言对象` });
    if (msg.author.id == muteMember.id) return msg.sendMsgExRef({ content: "禁止禁言自己" });
    if (muteTime && cmdMatch.del && !msg.message_reference) return msg.sendMsgExRef({ content: `未找到需要撤回消息` });
    if (muteTime > 60 * 60 * 24 * 30) return msg.sendMsgExRef({ content: `你要不看看你在干什么` });
    if (muteTime && muteTime < 60 * 60 * 1) return msg.sendMsgExRef({ content: `你在...干什么？` });

    const alart = await client.guildApi.guildMember(msg.guild_id, muteMember.id).then(res => {
        const { data } = res;
        if (!data || !data.roles) return null;
        if (data.roles.includes("4")) return "无法禁言频道主";
        if (data.roles.includes("2")) return "无法禁言超级管理员";
        if (data.roles.includes("5")) return "无法禁言子频道管理员";
        if (data.roles.includes("11146065")) return "无法禁言风纪委员会成员";
        return null;
    }).catch(err => {
        log.error(err);
        return `获取成员信息出错: ${JSON.stringify(err).replaceAll(".", "。")}`;
    }); // 检查身份组及相关权限
    if (alart) return msg.sendMsgExRef({ content: alart });

    await sendToAdmin(`mute ${cmdMatch.t} 触发` +
        `\n子频道: ${msg.channelName}(${msg.channel_id})` +
        `\n目标: ${muteMember.username}(${muteMember.id})` +
        `\n使用人: ${msg.author.username}(${msg.author.id})`
    );

    const muteLogChannel = await redis.hGet("mute:logChannel", msg.guild_id);
    if (muteLogChannel) await msg.sendMsgEx({
        content: `管理执行禁言权限` +
            `\n\n权限: ${JSON.stringify(msg?.member?.roles)}` +
            `\n管理: <@${msg.author.id}>(${msg.author.id})` +
            `\n目标: ${muteMember.username}(${muteMember.id})` +
            `\n原因: ${await redis.hGet("muteType", cmdMatch.t) || cmdMatch.t}` +
            `\n\n频道: ${msg.guildName}(${msg.guild_id})` +
            `\n子频道: <#${msg.channel_id}>(${msg.channel_id})` +
            `\n时间: ${timeConver(muteTime * 1000)}`,
        channelId: muteLogChannel,
    }); // 发送到记录子频道

    if (muteTime) {
        await redis.hSet(`mute:${muteMember!.id}`, new Date().getTime(), cmdMatch.t);
        await msg.sendMsgExRef({
            content: `已对成员<@${muteMember!.id}>的「${await redis.hGet("muteType", cmdMatch.t) || cmdMatch.t}」行为采取禁言${timeConver(muteTime * 1000)}`
                + `\n注意：若管理随意使用则会采取一定措施`,
        });
    } else {
        // TODO: 加点什么
        await msg.sendMsgExRef({ content: `已解除${await redis.hGet("muteType", cmdMatch.t) || cmdMatch.t}禁言` });
    }
    await client.muteApi.muteMember(msg.guild_id, muteMember!.id, { seconds: muteTime.toString() });

    const muteMap = await redis.hGetAll(`mute:${muteMember!.id}`);
    const sendStr = [
        "禁言记录",
        ...await Promise.all(Object
            .keys(muteMap)
            .map(async k => `时间: ${format.asString(new Date(Number(k)))} | 类型: ${await redis.hGet("muteType", muteMap[k]) || muteMap[k]}`)
        ),
    ];
    await msg.sendMsgExRef({ content: sendStr.join("\n") });

    if (cmdMatch.send && muteTime) {
        await client.messageApi.deleteMessage(msg.channel_id, msg.message_reference!.message_id);
        await msg.sendMsgEx({
            content: `<@${muteMember!.id}>(id: ${muteMember!.id})` +
                `\n禁言${timeMatch.muteTime}${timeMatch.m || timeMatch.h || timeMatch.d}` +
                `\n原因: ${await redis.hGet("muteType", cmdMatch.t) || cmdMatch.t}` +
                `\n子频道: <#${msg.channel_id}>(id: ${msg.channel_id})` +
                `\n处理人: <@${msg.author.id}>(id: ${msg.author.id})` +
                `\n注意: 该消息由bot自动发送，如有异议联系<@${msg.author.id}>或<@${adminId[0]}>`,
            channelId: await redis.hGet("mute:sendChannel", msg.guild_id)
        });
    }

}

export async function ban(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {
    const match = /^(?<isUnBan>un)?ban(?<isForce>f)?\s+(?<banType>group|guild|user)\s+(?<banId>\S+)(\s+(?<banDesc>\S+))?$/.exec(msg.content);
    if (!match || !match.groups) return msg.sendMsgEx({
        content: `指令错误, 格式: \n` +
            `(un)ban (group|guild|user) <id> <原因>`
    });
    const { isUnBan, banType, banId, banDesc, isForce } = match.groups;

    const isExist = await redis.hGet(`ban:use:${banType}`, banId);
    if (!isUnBan && isExist && !isForce) return msg.sendMsgEx({ content: `已存在该封禁, 理由:\n${isExist}` });
    const result = isUnBan ? await redis.hDel(`ban:use:${banType}`, banId) : await redis.hSet(`ban:use:${banType}`, banId, banDesc);

    return msg.sendMsgEx({
        content: `已${isUnBan || ""}ban ${result} ${(isForce && isExist) ? "(force)" : ""}`
            + `\n类型: ${banType}`
            + `\nid: ${banId}`
            + (isUnBan ? "" : `\n理由: ${banDesc}`),
    });
}