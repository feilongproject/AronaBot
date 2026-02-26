import format from 'date-format';
import { ParameterizedContext } from 'koa';
import { RouterParamContext } from '@koa/router';
import config from '../config/config';
import { awaitGroupEventId } from './libs/interactionGroup';

type Ctx = ParameterizedContext<any, RouterParamContext<any, {}>, any>;

export async function handlerSync(ctx: Ctx, requestBody: SyncMessageBody) {
    if (devEnv) log.debug(JSON.stringify(requestBody));
    try {
        await syncButton(ctx, requestBody);
        await syncMessage(ctx, requestBody);
    } catch (err) {
        log.error(err);
    }

    ctx.body = {
        status: 200,
    };
}

// 绑定button信息到群组
async function syncButton(ctx: Ctx, requestBody: SyncMessageBody) {
    const raw = requestBody?.raw;

    if (!raw) return (ctx.body = { status: 404 });
    const { peerUid: groupUid, peerUin } = raw;
    if (groupUid !== peerUin) return;
    const syncGroupButtonId = await redis.get(`syncGroupButtonId:${botType}:${groupUid}`);
    if (!syncGroupButtonId) return;

    for (const element of raw.elements) {
        if (element.elementType !== 17 || !element.inlineKeyboardElement) continue;
        const keyboard = element.inlineKeyboardElement;
        const appid = keyboard.botAppid;
        if (appid != meAppId) continue;

        for (const row of keyboard.rows) {
            for (const button of row.buttons) {
                if (button.type != 1) continue;
                if (syncGroupButtonId != button.id) continue;
                // console.log(button);
                const buttonData = button.data;
                await redis.set(`buttonData:${botType}:${groupUid}`, buttonData);
                log.info(`已为 ${botType} 在群 ${groupUid} 中绑定按钮id: ${buttonData}`);
            }
        }
    }
}

async function syncMessage(ctx: Ctx, requestBody: SyncMessageBody) {
    const groupRealId = requestBody.group_id.toString();
    if (requestBody.message_type !== 'group') return;
    if (requestBody.raw.elements.find((v) => v.textElement?.atUid == meRealId))
        return log.warn(`skip @bot`); // @bot的忽略
    if (requestBody.sender.user_id.toString() == meRealId) return log.warn('skip bot send'); // bot发送的忽略

    const groupId = Object.entries(config.bots[botType].groupMap).find(
        (v) => v[1] == groupRealId,
    )?.[0];
    if (devEnv) log.debug('syncMessage.group_id', groupRealId, groupId);
    if (!groupId) return log.warn(`syncMessage.group_id error: ${groupRealId} -> ${groupId}`);

    const eventId = await awaitGroupEventId(groupRealId);
    if (devEnv) log.debug('syncMessage.eventId', eventId);
    if (!eventId) return log.warn(`syncMessage.eventId not found`);

    const messageId = requestBody.message_id.toString();
    const msg: IntentMessage.GROUP_MESSAGE_body = {
        event_id: messageId,
        id: '',
        author: {
            id: requestBody.sender.user_id.toString(),
        },
        attachments: requestBody.message
            .filter((v) => v.type == 'image')
            .map((v) => ({
                content_type: 'image',
                url: v.data?.url || '',
                filename: v.data.file,
                size: Number(v.data.file_size),
            })),
        content: requestBody.raw_message,
        clean_content: requestBody.message
            .map((v) => (v.type == 'text' ? v.data.text : ''))
            .join(''),
        timestamp: format.asString(new Date(requestBody.time * 1000)),
        group_id: groupId,
        group_openid: groupRealId,
        isOffical: false,
        pushEventId: eventId,
    };

    global.ws.emit('GROUP_AND_C2C_EVENT', {
        eventId: eventId,
        eventType: IntentEventType.GROUP_AT_MESSAGE_CREATE,
        msg: msg,
    });
}
