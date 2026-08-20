import 'dotenv/config';
import Koa from 'koa';
import axios from 'axios';
import koaBody from 'koa-body';
import Router from '@koa/router';
import { init } from './init';
import { initRuntime } from './bootloader';
import { handlerSync } from './libs/handlerSync';
import config, { resolveEventTransport } from '../config/config';
import { EventMap } from './constants/EventMap';
import { registerSettingsRoutes } from './web/settings';

initRuntime();

const app = new Koa();
const router = new Router(); // 为什么之前没有移到顶层?
registerSettingsRoutes(router);

app.use(async (ctx, next) => {
    let rawData = '';
    ctx.req.on('data', (chunk) => (rawData += chunk));
    ctx.req.on('end', () => ((ctx.request as any).rawBody = rawData));
    await next();
});

const botCfg = config.bots[botType];
const { dev: devPORT, prod: PORT } = botCfg?.webhookPort || {};
if (!PORT || !devPORT) process.exit(1);

const eventTransport = resolveEventTransport(botCfg);
const listenPort = devEnv ? devPORT : PORT;

/** 本机回环地址，用于正式 → 开发事件镜像鉴权 */
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * 正式进程将已归一化的事件转发到本机开发进程。
 * - websocket / webhook 统一走此路径（webhook 先 emit 到 global.ws，再由此镜像）
 * - 依赖 Redis 键 `devEnv`（由 --dev 进程看门狗续期）
 * - 开发侧沙箱 WS 收不到平台消息时，靠此注入仍可调试
 * - 按 eventId 短去重，避免 webhook+ws 双通道各镜像一次
 */
async function mirrorEventToDev(payload: {
    eventRootType: string;
    eventId: string;
    eventType: string;
    msg: unknown;
}) {
    if (devEnv) return;
    if (!(await redis.get('devEnv'))) return;
    if (payload.eventId) {
        const mirrorKey = `devMirror:${payload.eventType}:${payload.eventId}`;
        if (await redis.exists(mirrorKey)) return;
        await redis.setEx(mirrorKey, 60, '1');
    }
    await axios({
        url: `http://127.0.0.1:${devPORT}/internal/dev-mirror/${botType}`,
        method: 'POST',
        timeout: 2000,
        headers: { 'Content-Type': 'application/json' },
        data: payload,
    }).catch(() => {});
}

init().then(() => {
    for (const eventRootType of config.bots[botType].intents) {
        log.mark(`开始监听 ${eventRootType} 事件`);
        global.ws.on(eventRootType, async (data: IntentMessage.EventRespose<any>) => {
            data.eventRootType = eventRootType;

            if (data?.msg?.author?.id == '2975E2CA5AE779F1899A0AED2D4FA9FD')
                log.debug(
                    `收到事件: ${eventRootType} ${data.eventType} ${data.eventId} ${JSON.stringify(data.msg)}`,
                );
            // 正式侧异步镜像；不阻塞本进程 eventRec（开发进程仍会 adminId 过滤）
            void mirrorEventToDev({
                eventRootType,
                eventId: data.eventId,
                eventType: data.eventType,
                msg: data.msg,
            });
            return import('./eventRec').then((e) => e.eventRec(data));
        });
    }

    // webhook 模式：注册官方事件入口；websocket 模式不注册（设置页等 HTTP 仍可用）
    if (eventTransport === 'webhook') {
        router.post(`/webhook/${botType}`, async (ctx, next) => {
            if (!ctx.request.body) {
                ctx.status = 400;
                return (ctx.body = { msg: 'need body' });
            }

            const sign = (ctx.req.headers['x-signature-ed25519'] || '').toString();
            const timestamp = (ctx.req.headers['x-signature-timestamp'] || '').toString();
            const rawBody: string = (ctx.request as any).rawBody;
            const isValid = client.webhookApi.validSign(timestamp, rawBody, sign);
            // if (devEnv) log.debug(isValid, sign, timestamp, rawBody);
            if (!isValid) {
                ctx.status = 400;
                return (ctx.body = { msg: 'invalid signature' });
            }
            // debugger;
            const body: EventBody = ctx.request.body as unknown as EventBody;
            // log.info(`收到webhook: ${body.op} ${body.id || ""}`);

            if (body.op == 13) {
                return (ctx.body = {
                    plain_token: body.d.plain_token,
                    signature: client.webhookApi.getSign(body.d.event_ts, body.d.plain_token),
                }); // op13 可能是 webhook验证相关？
            }

            const rootType = Object.entries(EventMap).find((v) =>
                (v[1] as string[]).includes(body.t),
            );
            // log.debug(rootType, body.t);
            if (rootType) {
                // 经 global.ws 统一分发；正式 → 开发镜像在 ws.on 内完成（不再在此二次 HTTP 转发）
                global.ws.emit(rootType[0], {
                    eventId: body.id,
                    eventType: body.t,
                    msg: body.d,
                });
            }

            ctx.body = { msg: 'ok' };
            ctx.status = 200;
        });
        log.info(
            `eventTransport=webhook：已注册 POST /webhook/${botType}，并保持 WebSocket 双通道`,
        );
    } else {
        log.info(
            `eventTransport=websocket：未注册 Webhook 事件入口，仅 WebSocket 收事件；HTTP :${listenPort} 仍提供设置页等`,
        );
    }

    // 正式 → 开发事件镜像入口（websocket / webhook 均注册；仅 --dev 进程接受）
    router.post(`/internal/dev-mirror/${botType}`, async (ctx) => {
        if (!devEnv) {
            ctx.status = 403;
            return (ctx.body = { msg: 'only dev process accepts event mirror' });
        }
        const ip = (ctx.ip || ctx.request.ip || '').replace(/^::ffff:/, '');
        if (!LOOPBACK_IPS.has(ctx.ip) && !LOOPBACK_IPS.has(ip) && ip !== '127.0.0.1') {
            ctx.status = 403;
            return (ctx.body = { msg: 'loopback only' });
        }
        const body = (ctx.request.body || {}) as {
            eventRootType?: string;
            eventId?: string;
            eventType?: string;
            msg?: unknown;
        };
        if (!body.eventRootType || !body.eventType) {
            ctx.status = 400;
            return (ctx.body = { msg: 'need eventRootType and eventType' });
        }
        // 注入本进程事件总线；dev 侧 mirrorEventToDev 会因 devEnv 直接 return，不会回环
        global.ws.emit(body.eventRootType, {
            eventId: body.eventId,
            eventType: body.eventType,
            msg: body.msg,
        });
        ctx.body = { msg: 'ok' };
        ctx.status = 200;
    });

    router
        .get(`${botType}`, (ctx, next) => {
            ctx.body = { msg: 'hello world' };
        })
        .post(`/sync`, async (ctx, next) => {
            // 接收ntqq消息绑定按钮id
            if (!ctx.request.body) return (ctx.status = 400);
            const requestBody = ctx.request.body as any;
            // if (devEnv) log.debug('sync', requestBody);
            await handlerSync(ctx, requestBody);
        })
        .post(`/sendToGroupHandler`, async (ctx, next) => {
            // 接收其他端消息触发事件
            if (!ctx.request.body) return (ctx.status = 400);
            const { type, data, groupUid } = (ctx.request.body || {}) as Record<string, string>;
            if (devEnv) log.debug(`${botType}.sendToGroupHandler`, type, data, groupUid);
            if (!type || !data) return (ctx.body = { message: `type or data is unset` });
            const result = await (
                await import('./plugins/interaction')
            ).sendToGroupHandler(type, data, groupUid);
            ctx.body = result || { message: 'ok' };
        })
        .get(`/ping`, (ctx, next) => {
            ctx.body = `pong`;
        });

    app.use(async (ctx, next) => {
        await next();
        // 仅当响应体 status 是数字时才作为 HTTP 状态码；字符串是业务字段（如图库通过/拒绝后的新状态）
        const bodyStatus = ctx.body?.status;
        ctx.status = typeof bodyStatus === 'number' ? bodyStatus : ctx.status || 200;
    });
    app.use(koaBody({ multipart: true }));
    app.use(router.routes());
    app.use(router.allowedMethods());
    app.listen(listenPort, async () => {
        log.info(
            `HTTP PORT: ${listenPort} 服务运行中......（eventTransport=${eventTransport}，设置页 /settings）`,
        );
    });
    // global.devEnv = true; // BREAK
});
