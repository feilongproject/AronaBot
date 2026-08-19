import format from 'date-format';
import { ParameterizedContext } from 'koa';
import { RouterParamContext } from '@koa/router';
import config from '../../config/config';
import { awaitGroupEventId } from './interactionGroup';

type Ctx = ParameterizedContext<any, RouterParamContext<any, {}>, any>;

export async function handlerSync(ctx: Ctx, requestBody: SyncMessageBody) {
    // if (devEnv) log.debug(JSON.stringify(requestBody));
    if (requestBody.post_type == 'meta_event' && requestBody.meta_event_type == 'heartbeat') return;
    try {
        await syncGroupRealId(ctx, requestBody);
        // await syncButton(ctx, requestBody);
        // await syncMessage(ctx, requestBody);
    } catch (err) {
        log.error(err);
    }

    ctx.body = {
        status: 200,
    };
}

async function syncGroupRealId(ctx: Ctx, requestBody: SyncMessageBody) {
    const { message_type, group_id, user_id, raw_message } = requestBody;
    if (user_id.toString() != config.bots[botType].meRealId) return; // 只处理机器人自己发送的消息
    if (message_type !== 'group') return; // 只处理群消息
    const groupRealId = group_id.toString(); // 群消息的真实群ID
    const userRealInfo = requestBody.raw.elements.find((v) => v.elementType == 7)?.replyElement; // 群消息的真实用户ID
    const { user_openid, group_openid } =
        /^get groupInfo (?<user_openid>[0-9A-Z]+) (?<group_openid>[0-9A-Z]+)$/.exec(raw_message)
            ?.groups || {};
    if (!group_openid || !user_openid || !userRealInfo) return; // 只处理特定格式的消息

    await redis.hSet(`config:groupRealId:${botType}`, group_openid, groupRealId);
    await redis.hSet(`config:userRealId:${botType}`, user_openid, userRealInfo.senderUid);
    log.debug(`syncGroupRealId: group_openid=${group_openid}, groupRealId=${groupRealId}`);
}
