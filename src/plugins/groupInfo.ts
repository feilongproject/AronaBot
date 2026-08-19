import type { IBotState } from 'qq-bot-sdk';
import { IMessageGROUP } from '../libs/IMessageEx';
import config from '../../config/config';

const RECV_MSG_SETTING_LABEL: Record<IBotState['recv_msg_setting'], string> = {
    all: '全部消息',
    only_mention: '仅 @ 机器人',
    mention_and_context: '@ 机器人及上下文',
};

const MEMBER_ROLE_LABEL: Record<IBotState['member_role'], string> = {
    member: '普通成员',
    admin: '管理员',
    owner: '群主',
};

export async function groupInfo(msg: IMessageGROUP) {
    // if (!adminId.includes(msg.author.id)) return;
    const callbackGroupId = (await redis.hGet('config', `callbackGroup`)) as string;
    const sendToId = Object.entries(config.bots[botType].groupMap).find(
        (v) => v[1] === callbackGroupId,
    )?.[0];
    const groupOpenId = msg.group_openid;
    const userOpenId = msg.author.member_openid;

    if (!groupOpenId || !userOpenId || !sendToId) {
        return await msg.sendMsgEx({
            content: `groupOpenId or userOpenId or sendToId, is null`,
        });
    }
    await msg.sendMsgEx(`获取中，等待后端回调`);
    await msg.sendMsgEx({
        content: `get groupInfo ${userOpenId} ${groupOpenId}`,
        sendToId: sendToId,
        ref: true,
        msgId: ' ',
    });
    await sleep(5_000);
    const realGroupId = await redis.hGet(`config:groupRealId:${botType}`, groupOpenId);
    const realUserId = await redis.hGet(`config:userRealId:${botType}`, userOpenId);
    return await msg.sendMsgEx(
        [
            `群ID: ${msg.group_openid || msg.group_id}`,
            `用户ID: ${msg.author.id}`,
            `真实群ID: ${realGroupId}`,
            `真实用户ID: ${realUserId}`,
            `msgId: ${msg.id}`,
            `msgIdx: ${msg.refs.msgIdx}`,
            `refMsgIdx: ${msg.refs.refMsgIdx}`,
        ].join('\n'),
    );

    try {
        const [groupInfoRes, botStateRes] = await Promise.all([
            client.groupApi.info(msg.group_openid),
            client.groupApi.botState(msg.group_openid),
        ]);
        const groupInfo = groupInfoRes.data;
        const botState = botStateRes.data;
        const joinedAt = new Date(botState.joined_at);
        const joinedAtText = Number.isNaN(joinedAt.getTime())
            ? botState.joined_at
            : joinedAt.toLocaleString('zh-CN', { hour12: false });

        const content = [
            '===== 群信息 =====',
            `群名称: ${groupInfo.group_name}`,
            `群简介: ${groupInfo.group_finger_memo || '（无）'}`,
            `群分类: ${groupInfo.group_class_text || '（无）'}`,
            `群标签: ${groupInfo.group_tags.length ? groupInfo.group_tags.join('、') : '（无）'}`,
            `群成员数: ${groupInfo.group_member_num}`,
            `群 OpenID: ${groupInfo.group_openid}`,
            '===== 机器人状态 =====',
            `入群时间: ${joinedAtText}`,
            `接收消息设置: ${(RECV_MSG_SETTING_LABEL as any)[botState.recv_msg_setting]}`,
            `主动消息推送: ${botState.allow_proactive_msg ? '开启' : '关闭'}`,
            `成员角色: ${(MEMBER_ROLE_LABEL as any)[botState.member_role]}`,
            `机器人 OpenID: ${botState.member_openid}`,
        ].join('\n');

        return msg.sendMsgEx({ content });
    } catch (err) {
        log.error(`groupInfo 获取群信息失败: ${err}`);
        return msg.sendMsgExRef({
            content: `获取群信息失败: ${String(err).replaceAll('.', ',')}`,
        });
    }
}
