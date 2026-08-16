import type { IBotState } from 'qq-bot-sdk';
import { IMessageGROUP } from '../libs/IMessageEx';

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
    if (!adminId.includes(msg.author.id)) return;

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
