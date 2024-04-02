import fetch from "node-fetch";
import { UpdateRoleRes } from "qq-bot-sdk";
import { sendToAdmin } from "../libs/common";
import { IMessageGUILD } from "../libs/IMessageEx";
import { emojiMap } from "../eventRec";
import config from "../../config/config";


export async function roleAssign(event: IntentMessage.GUILD_MESSAGE_REACTIONS) {
    // log.debug(event);
    const { msg } = event;
    if (msg.target.type != "ReactionTargetType_MSG") return;
    // if(msg.user_id==meId)return;

    const roleType = await redis.hGet("roleAssign:target", `${msg.guild_id}:${msg.target.id}:${msg.emoji.id}`); // 消息对应的身份类型
    if (!roleType) return;
    const roleTypeDesc = await redis.hGet("roleAssign:desc", `${msg.guild_id}:${roleType}`) || roleType;

    const userInfo = (await client.guildApi.guildMember(msg.guild_id, msg.user_id)).data;
    if (userInfo.user.bot) return; // 筛选是否bot
    const userRoles = userInfo.roles; // 用户当前所有身份组
    const assignedRoles = await redis.lRange(`roleAssign:groups:${roleType}`, 0, -1); // 消息类型对应的身份组
    const isMember = assignedRoles.find(v => userRoles.includes(v)); // 是否已经加入到身份类型对应的身份组
    // log.debug(userInfo);


    if (event.eventType == "MESSAGE_REACTION_ADD") {
        log.info(`${userInfo.nick}(${msg.user_id}) 加入身份组 ${roleType}`);
        if (isMember) return sendToAdmin(`用户 ${userInfo.nick}(${msg.user_id}) 已加入身份组 ${roleType}`);
        const __guildRoles = (await client.roleApi.roles(msg.guild_id)).data;
        const _guildRoles = __guildRoles.roles.filter(v => assignedRoles.includes(v.id));
        const guildRole = _guildRoles.find(v => v.member_limit > v.number);
        if (guildRole) return client.memberApi.memberAddRole(msg.guild_id, guildRole.id, msg.user_id);
        else {
            await redis.hSetNX("roleAssign:color", `${msg.guild_id}:${roleType}`, randomColor());
            const roleTypeColor = _guildRoles[0]?.color || parseInt(await redis.hGet("roleAssign:color", `${msg.guild_id}:${roleType}`) || randomColor(), 16);

            const newRole = await createRole(msg.guild_id, { name: roleTypeDesc, color: roleTypeColor, });
            // log.debug(newRole, roleTypeDesc, roleTypeColor);
            await sendToAdmin(
                `已创建新身份组`
                + `\n频道: ${saveGuildsTree[msg.guild_id]?.name}(${msg.guild_id})`
                + `\n身份组: ${roleTypeDesc}(${newRole.role_id}) ${roleTypeColor}`
            );
            await redis.lPush(`roleAssign:groups:${roleType}`, newRole.role_id);
            return client.memberApi.memberAddRole(msg.guild_id, newRole.role_id, msg.user_id);
        }

    } else if (event.eventType == "MESSAGE_REACTION_REMOVE") {
        log.info(`${userInfo.nick}(${msg.user_id}) 退出身份组 ${roleType}`);
        if (isMember) return client.memberApi.memberDeleteRole(msg.guild_id, isMember, msg.user_id);
        else return sendToAdmin(`用户 ${userInfo.nick}(${msg.user_id}) 在身份组 ${roleType} 不存在`);
    }

}

export async function createVirtualRole(msg: IMessageGUILD) {
    const match = /^\/?创建虚拟身份组\s*([A-Za-z0-9]+)\s+(.*?)\s*<emoji:(\d+)>\s*#?([0-9a-fA-F]{6})$/.exec(msg.content);
    // log.debug(match);
    if (!match) return msg.sendMsgExRef({
        content:
            `创建虚拟身份组失败，请按照指定格式使用指令：`
            + `\n创建虚拟身份组 {用户组标签(需全英)} {用户组名称} {领取时使用的表情} [用户组颜色(十六进制)]`,
    });
    // log.debug(match);
    const roleType = match[1];
    const roleTypeDesc = match[2];
    const emojiId = match[3];
    const roleTypeColor = match[4];

    const rt = await redis.hGet("roleAssign:bind", `${msg.guild_id}:${emojiId}`);
    if (rt) return msg.sendMsgExRef({ content: `当前表情已分配给${rt}` });

    await redis.hSet("roleAssign:bind", `${msg.guild_id}:${emojiId}`, roleType);
    await redis.hSet("roleAssign:desc", `${msg.guild_id}:${roleType}`, roleTypeDesc);
    await redis.hSet("roleAssign:color", `${msg.guild_id}:${roleType}`, roleTypeColor);
    // await redis.lPush(`roleAssign:${roleType}`, newRole.role_id);
    return msg.sendMsgExRef({
        content:
            `已设置虚拟身份组`
            + `\n${roleTypeDesc}(${roleType}) ${roleTypeColor}`
            + `\n表情: ${emojiMap[emojiId] || `<emoji:${emojiId}>`}`
    });
}

export async function createRoleAssignMsg(msg: IMessageGUILD) {
    const allBind = await findAllBind(msg.guild_id);

    const m = await msg.sendMsgEx({
        content: `使用表情领取身份组` +
            `\n目前已采用智能分流, 若身份组已满则会自动创建相同的新身份组\n` +
            allBind.map(v => `选择 ${emojiMap[v.field] || `<emoji:${v.field}>`} 领取 【${v.desc}】身份组`).join("\n"),
    });
    if (!m.result) return sendToAdmin(`createRoleAssignMsg 失败\n${JSON.stringify(m.errors)}`);

    // for (const bind of allBind) {
    //     await client.reactionApi.postReaction(m.result?.channel_id, {
    //         message_id: m.result.id,
    //         emoji_type: emojiMap[bind.field] ? 1 : 2,
    //         emoji_id: bind.field,
    //     });
    // }

    for await (const target of redis.hScanIterator("roleAssign:target", { MATCH: `${m.result.guild_id}:*` })) {
        await redis.hDel("roleAssign:target", target.field);
    } // 删除所有关联消息

    for (const bind of allBind) {
        await redis.hSet("roleAssign:target", `${msg.guild_id}:${m.result.id}:${bind.field}`, bind.value);
    }

}

export async function deleteRoleAssign(msg: IMessageGUILD) {
    const match = /^\/?删除虚拟身份组\s*(([A-Za-z0-9]+)|<emoji:(\d+)>)\s*$/.exec(msg.content);
    if (!match) return msg.sendMsgExRef({
        content:
            `删除虚拟身份组失败，请按照指定格式使用指令：`
            + `\n/删除虚拟身份组 {用户组标签(需全英)/绑定的表情}`
    });
    const emojiId: string | undefined = match[3];
    const roleType = match[2] || await redis.hGet("roleAssign:bind", `${msg.guild_id}:${emojiId}`);
    if (!roleType) return msg.sendMsgExRef({ content: `emojiId:${emojiId} 对应的身份组不存在` });
    log.info(`删除虚拟身份组 emojiId:${emojiId} roleType:${roleType}`);

    for await (const bind of redis.hScanIterator("roleAssign:bind", { MATCH: `${msg.guild_id}:*` })) {
        if (bind.value == roleType) await redis.hDel("roleAssign:bind", bind.field);
    }
    for await (const bind of redis.hScanIterator("roleAssign:target", { MATCH: `${msg.guild_id}:*` })) {
        if (bind.value == roleType) await redis.hDel("roleAssign:target", bind.field);
    }
    await redis.hDel("roleAssign:desc", `${msg.guild_id}:${roleType}`);
    await redis.hDel("roleAssign:color", `${msg.guild_id}:${roleType}`);
    await redis.del(`roleAssign:groups:${roleType}`);

    return msg.sendMsgEx({ content: `已删除虚拟身份组 emojiId:${emojiId} roleType:${roleType}` });
}

async function findAllBind(guildId: string) {
    const ret: { field: string; value: string; desc: string; }[] = [];

    const p = async (items: { field: string; value: string; }[]) => {
        for (const { field, value } of items) ret.push({
            field: field.replace(`${guildId}:`, ""),
            value,
            desc: await redis.hGet("roleAssign:desc", `${guildId}:${value}`) || value,
        });
    }

    var next = await redis.hScan("roleAssign:bind", 0, { MATCH: `${guildId}:*`, COUNT: 100, });
    await p(next.tuples);
    while (next.cursor != 0) {
        next = await redis.hScan("roleAssign:bind", next.cursor, { MATCH: `${guildId}:*`, COUNT: 100, });
        await p(next.tuples);
    }
    return ret;
}

async function createRole(guildId: string, data: { name: string; color?: number; hoist?: 0 | 1; }): Promise<UpdateRoleRes> {
    return fetch(`https://api.sgroup.qq.com/guilds/${guildId}/roles`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`,
        },
        body: JSON.stringify(data),
    }).then(res => res.json());
}

function randomColor(): string {
    return Math.floor(Math.random() * 255).toString(16) + Math.floor(Math.random() * 255).toString(16) + Math.floor(Math.random() * 255).toString(16);
}