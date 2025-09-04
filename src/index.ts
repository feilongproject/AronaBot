import Koa from "koa";
import koaBody from "koa-body";
import Router from "koa-router";
import { init } from './init';
import config from "../config/config";


init().then(() => {
    for (const eventRootType of config.bots[botType].intents) {
        log.mark(`开始监听 ${eventRootType} 事件`);
        global.ws.on(eventRootType, async (data: IntentMessage.EventRespose<any>) => {
            data.eventRootType = eventRootType;
            return import("./eventRec").then(e => e.eventRec(data));
        });
    }


    // if (botType != "PlanaBot") return;

    const { dev: devPORT, prod: PORT } = config.bots[botType]?.webhookPort;
    if (!PORT || !devPORT) return;
    const app = new Koa();
    const router = new Router();
    app.use(async (ctx, next) => {
        let rawData = '';
        ctx.req.on('data', chunk => rawData += chunk);
        ctx.req.on('end', () => (ctx.request as any).rawBody = rawData);
        await next();
    });

    router.post(`/webhook/${botType}`, async (ctx, next) => {
        const sign = ctx.req.headers["x-signature-ed25519"] as string;
        const timestamp = ctx.req.headers["x-signature-timestamp"] as string;
        const rawBody: string = (ctx.request as any).rawBody;
        const isValid = client.webhookApi.validSign(timestamp, rawBody, sign);
        // if (devEnv) log.debug(isValid, sign, timestamp, rawBody);
        if (!isValid) {
            ctx.status = 400;
            return ctx.body = { msg: "invalid signature" };
        }
        // debugger;
        const body: EventBody = ctx.request.body;
        // log.info(`收到webhook: ${body.op} ${body.id || ""}`);

        if (body.op == 13) return ctx.body = {
            plain_token: body.d.plain_token,
            signature: client.webhookApi.getSign(body.d.event_ts, body.d.plain_token),
        }; // op13 可能是 webhook验证相关？

        const rootType = Object.entries(EventMap).find(v => (v[1] as string[]).includes(body.t));
        // log.debug(rootType, body.t);
        if (rootType) global.ws.emit(rootType[0], {
            eventId: body.id,
            eventType: body.t,
            msg: body.d,
        });

        if (await redis.get("devEnv") && !devEnv) {
            await fetch(`http://127.0.0.1:${devPORT}/webhook/${botType}`, {
                method: "POST",
                headers: ctx.headers as Record<string, string>,
                body: rawBody,
            }).catch(err => { });
        }
        ctx.body = { msg: "ok" };
        ctx.status = 200;
    }).get(`${botType}`, (ctx, next) => {
        ctx.body = { msg: "hello world" };
    }).post(`/sync`, async (ctx, next) => {
        const raw = ctx.request.body?.raw;

        if (!raw) return ctx.body = { status: 404 };
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

        ctx.body = {
            status: 200,
        };
    }).post(`/sendToGroupHandler`, async (ctx, next) => {
        const { type, data, groupUid } = ctx.request.body || {};
        if (devEnv) log.debug(`${botType}.sendToGroupHandler`, type, data, groupUid);
        if (!type || !data) return ctx.body = { message: `type or data is unset` };
        const result = await (await import('./plugins/interaction')).sendToGroupHandler(type, data, groupUid);
        ctx.body = result || { message: "ok" };

    }).get(`/ping`, (ctx, next) => {
        ctx.body = `pong`;
    });


    app.use(async (ctx, next) => {
        await next();
        ctx.status = ctx.body?.status || ctx.status || 200;
    });
    app.use(koaBody({ multipart: true }));
    app.use(router.routes());
    app.use(router.allowedMethods());
    app.listen(devEnv ? devPORT : PORT, async () => {
        log.info(`webhook PORT: ${devEnv ? devPORT : PORT} 服务运行中......`);
    });

});

const EventMap = {
    GROUP_AND_C2C_EVENT: [
        IntentEventType.GROUP_ADD_ROBOT,
        IntentEventType.GROUP_AT_MESSAGE_CREATE,
        IntentEventType.GROUP_DEL_ROBOT,
        IntentEventType.GROUP_MSG_RECEIVE,
        IntentEventType.GROUP_MSG_REJECT,
        IntentEventType.C2C_MESSAGE_CREATE,
        IntentEventType.C2C_MSG_RECEIVE,
        IntentEventType.C2C_MSG_REJECT,
        IntentEventType.FRIEND_ADD,
        IntentEventType.FRIEND_DEL,
        IntentEventType.SUBSCRIBE_MESSAGE_STATUS,
    ],
    PUBLIC_GUILD_MESSAGES: [
        IntentEventType.AT_MESSAGE_CREATE,
        IntentEventType.PUBLIC_MESSAGE_DELETE,
    ],
    GUILDS: [
        IntentEventType.GUILD_CREATE,
        IntentEventType.GUILD_DELETE,
        IntentEventType.GUILD_UPDATE,
        IntentEventType.CHANNEL_CREATE,
        IntentEventType.CHANNEL_DELETE,
        IntentEventType.CHANNEL_UPDATE,
    ],
    GUILD_MEMBERS: [
        IntentEventType.GUILD_MEMBER_ADD,
        IntentEventType.GUILD_MEMBER_UPDATE,
        IntentEventType.GUILD_MEMBER_REMOVE,
        IntentEventType.GUILD_MEMBER_REMOVE,
    ],
    GUILD_MESSAGES: [
        IntentEventType.MESSAGE_CREATE,
        IntentEventType.MESSAGE_DELETE,
    ],
    GUILD_MESSAGE_REACTIONS: [
        IntentEventType.MESSAGE_REACTION_ADD,
        IntentEventType.MESSAGE_REACTION_REMOVE,
    ],
    DIRECT_MESSAGE: [
        IntentEventType.DIRECT_MESSAGE_CREATE,
        IntentEventType.DIRECT_MESSAGE_DELETE,
    ],
    MESSAGE_AUDIT: [
        IntentEventType.MESSAGE_AUDIT_PASS,
        IntentEventType.MESSAGE_AUDIT_REJECT,
    ],
    FORUMS_EVENT: [
        IntentEventType.FORUM_THREAD_CREATE,
        IntentEventType.FORUM_THREAD_UPDATE,
        IntentEventType.FORUM_THREAD_DELETE,
        IntentEventType.FORUM_POST_CREATE,
        IntentEventType.FORUM_POST_DELETE,
        IntentEventType.FORUM_REPLY_CREATE,
        IntentEventType.FORUM_REPLY_DELETE,
        IntentEventType.FORUM_PUBLISH_AUDIT_RESULT,
    ],
    OPEN_FORUMS_EVENT: [
        IntentEventType.OPEN_FORUM_THREAD_CREATE,
        IntentEventType.OPEN_FORUM_THREAD_UPDATE,
        IntentEventType.OPEN_FORUM_THREAD_DELETE,
        IntentEventType.OPEN_FORUM_POST_CREATE,
        IntentEventType.OPEN_FORUM_POST_DELETE,
        IntentEventType.OPEN_FORUM_REPLY_CREATE,
        IntentEventType.OPEN_FORUM_REPLY_DELETE,
    ],
    INTERACTION: [IntentEventType.INTERACTION_CREATE],
}

interface EventBody {
    d: {
        plain_token: string,
        event_ts: string,
    },
    op: 13,
    id: string;
    t: string;
}
