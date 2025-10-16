import Koa from "koa";
import koaBody from "koa-body";
import Router from "koa-router";
import { init } from './init';
import { handlerSync } from "./handlerSync";
import config from "../config/config";
import { EventMap } from "./constants/EventMap";


init().then(() => {
    for (const eventRootType of config.bots[botType].intents) {
        log.mark(`开始监听 ${eventRootType} 事件`);
        global.ws.on(eventRootType, async (data: IntentMessage.EventRespose<any>) => {
            data.eventRootType = eventRootType;
            return import("./eventRec").then(e => e.eventRec(data));
        });
    }


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
        const sign = (ctx.req.headers["x-signature-ed25519"] as string).toString();
        const timestamp = (ctx.req.headers["x-signature-timestamp"] as string).toString();
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
    }).post(`/sync`, async (ctx, next) => { // 接收ntqq消息绑定按钮id
        const requestBody = ctx.request.body;
        await handlerSync(ctx, requestBody);

    }).post(`/sendToGroupHandler`, async (ctx, next) => { // 接收其他端消息触发事件
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
    // global.devEnv = true; // BREAK

});




