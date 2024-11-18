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


    if (botType != "PlanaBot") return;

    const PORT = devEnv ? 2333 : 2334;
    const app = new Koa();
    const router = new Router();
    app.use(async (ctx, next) => {
        let rawData = '';
        ctx.req.on('data', chunk => rawData += chunk);
        ctx.req.on('end', () => (ctx.request as any).rawBody = rawData);
        await next();
    });

    router.post("/webhook", async (ctx, next) => {
        const sign = ctx.req.headers["x-signature-ed25519"] as string;
        const timestamp = ctx.req.headers["x-signature-timestamp"] as string;
        const rawBody = (ctx.request as any).rawBody;
        const isValid = client.webhookApi.validSign(timestamp, rawBody, sign);
        if (!isValid) {
            ctx.status = 400;
            ctx.body = { msg: "invalid signature" };
            return;
        }
        // debugger;
        const body: EventBody = ctx.request.body;
        // log.info(`收到webhook: ${body.op} ${body.id || ""}`);

        if (body.op == 13) return ctx.body = {
            plain_token: body.d.plain_token,
            signature: client.webhookApi.getSign(body.d.event_ts, body.d.plain_token),
        }; // op13 可能是 webhook验证相关？

        const rootType = Object.entries(EventMap).find(v => (v[1] as string[]).includes(body.t));
        if (rootType) global.ws.emit(rootType[0], {
            eventId: body.id,
            eventType: body.t,
            msg: body.d,
        });

        if (await redis.get("devEnv") && !devEnv) {
            await fetch(`http://127.0.0.1:2333/webhook`, {
                method: "POST",
                headers: ctx.headers as Record<string, string>,
                body: rawBody,
            }).catch(err => { });
        }
        ctx.body = { msg: "ok" };
        ctx.status = 200;
    }).get("/", (ctx, next) => {
        ctx.body = { msg: "hello world" };
    });

    app.use(async (ctx, next) => {
        await next();
        ctx.status = ctx.body?.status || ctx.status || 200;
    });
    app.use(koaBody({ multipart: true }));
    app.use(router.routes());
    app.use(router.allowedMethods());
    app.listen(PORT, async () => {
        log.info(`webhook PORT: ${PORT} 服务运行中......`);
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
    ],
    PUBLIC_GUILD_MESSAGES: [
        IntentEventType.AT_MESSAGE_CREATE,
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
