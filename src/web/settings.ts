import fs from 'fs';
import path from 'path';
import Router from '@koa/router';
import type { Context, Next } from 'koa';
import config, {
    getAIConfigFilePath,
    getConfigFilePath,
    normalizeRawConfigPaths,
    previewJoinedPath,
    readAISchema,
    readRawAIConfigFile,
    readRawConfigFile,
    readSettingsSchema,
    resolveRootPath,
    writeRawAIConfigFile,
    writeRawConfigFile,
} from '../../config/config';
import { chatCollection, CHAT_COLLECTION, aiDb } from '../plugins/chatbot/db';

const STICKER_STATUSES = new Set(['pending', 'ready', 'hidden', 'rejected']);

/** 删除 COS 对象（回调风格封装为 Promise） */
function cosDeleteObject(key: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        global.cos.deleteObject(
            { Bucket: config.cos.Bucket, Region: config.cos.Region, Key: key },
            (err: unknown, data: unknown) => (err ? reject(err) : resolve(data)),
        );
    });
}

/** Vue3 构建产物目录（pnpm --dir web build → public/settings） */
const SETTINGS_DIST = path.join(process.cwd(), 'public', 'settings');
const SETTINGS_INDEX = path.join(SETTINGS_DIST, 'index.html');

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
};

function getWebSettings(): WebSettingsConfig {
    // 优先读磁盘最新值（设置页改 token 后无需重启即可用新 token 校验）
    try {
        const raw = readRawConfigFile();
        return {
            enabled: raw.webSettings?.enabled !== false,
            token: raw.webSettings?.token || '',
        };
    } catch {
        return { enabled: false, token: '' };
    }
}

function extractToken(ctx: Context): string {
    const header = (ctx.get('x-settings-token') || ctx.get('authorization') || '').trim();
    if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
    if (header) return header;
    const q = ctx.query.token;
    return typeof q === 'string' ? q : '';
}

function requireSettingsAuth(ctx: Context): boolean {
    const ws = getWebSettings();
    if (!ws.enabled) {
        ctx.status = 403;
        ctx.body = { message: 'Web 设置页已禁用（webSettings.enabled=false）' };
        return false;
    }
    if (!ws.token) {
        ctx.status = 403;
        ctx.body = { message: '未配置 webSettings.token，拒绝访问' };
        return false;
    }
    const token = extractToken(ctx);
    if (!token || token !== ws.token) {
        ctx.status = 401;
        ctx.body = { message: '口令无效' };
        return false;
    }
    return true;
}

function validateConfigShape(data: unknown): data is AppConfigFile {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (!obj.bots || typeof obj.bots !== 'object' || Array.isArray(obj.bots)) return false;
    if (typeof obj.cosUrl !== 'string') return false;
    if (typeof obj.retryTime !== 'number') return false;
    if (!obj.redis || typeof obj.redis !== 'object') return false;
    if (!obj.mariadb || typeof obj.mariadb !== 'object') return false;
    if (!obj.mongo || typeof obj.mongo !== 'object') return false;
    if (!obj.cos || typeof obj.cos !== 'object') return false;
    return true;
}

async function saveConfigHandler(ctx: Context) {
    if (!requireSettingsAuth(ctx)) return;
    const body = (ctx.request.body || {}) as { config?: unknown };
    const data = body.config ?? body;
    if (!validateConfigShape(data)) {
        ctx.status = 400;
        ctx.body = {
            message:
                '配置结构不合法：需要包含 bots / redis / mariadb / mongo / cos / cosUrl / retryTime 等字段',
        };
        return;
    }
    try {
        const hot = writeRawConfigFile(data);
        if (typeof log !== 'undefined') {
            log.mark(
                `[web-settings] 配置已写入并热加载 by remote ${ctx.ip} applied=${hot.applied.join(',') || '-'}`,
            );
        }
        const appliedText = hot.applied.length
            ? `已热生效: ${hot.applied.join('、')}`
            : '内存配置已更新';
        const deferredText = hot.deferred.length
            ? `仍需重启才生效: ${hot.deferred.join('；')}`
            : '';
        ctx.body = {
            ok: true,
            configPath: getConfigFilePath(),
            botType: typeof botType !== 'undefined' ? botType : null,
            devEnv: typeof devEnv !== 'undefined' ? devEnv : false,
            hotReload: hot,
            hint: [
                `已写入 settings.json（含 $schema），并热替换当前进程内存配置。`,
                '字段说明见 config/settings.schema.json（编辑器可补全/校验）。',
                appliedText,
                deferredText,
            ]
                .filter(Boolean)
                .join('\n'),
        };
    } catch (err) {
        ctx.status = 500;
        ctx.body = { message: `写入配置失败: ${(err as Error).message}` };
    }
}

async function saveAIConfigHandler(ctx: Context) {
    if (!requireSettingsAuth(ctx)) return;
    const body = (ctx.request.body || {}) as { config?: unknown };
    const data = body.config ?? body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        ctx.status = 400;
        ctx.body = { message: 'AI 配置格式不合法：需要 JSON 对象（含 bots 等字段）' };
        return;
    }
    try {
        const hot = writeRawAIConfigFile(data);
        if (typeof log !== 'undefined') {
            log.mark(
                `[web-settings] AI 配置已写入并热加载 by remote ${ctx.ip} applied=${hot.applied.join(',') || '-'}`,
            );
        }
        ctx.body = {
            ok: true,
            configPath: getAIConfigFilePath(),
            botType: typeof botType !== 'undefined' ? botType : null,
            devEnv: typeof devEnv !== 'undefined' ? devEnv : false,
            hotReload: hot,
            hint: [
                '已写入 ai.json（含 $schema），并热替换当前进程 AI 配置（dsKey/chatbot 立即生效）。',
                '字段说明见 config/ai.schema.json（编辑器可补全/校验）。',
            ].join('\n'),
        };
    } catch (err) {
        ctx.status = 500;
        ctx.body = { message: `写入 AI 配置失败: ${(err as Error).message}` };
    }
}

/**
 * 安全解析 SPA 静态资源路径，防止 path traversal
 */
function resolveStaticFile(urlPath: string): string | null {
    // /settings 或 /settings/ → index.html
    let rel = urlPath.replace(/^\/settings\/?/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    // 去掉 query
    rel = rel.split('?')[0];
    const abs = path.normalize(path.join(SETTINGS_DIST, rel));
    if (!abs.startsWith(SETTINGS_DIST)) return null;
    return abs;
}

function sendFile(ctx: Context, filePath: string): boolean {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    ctx.type = MIME[ext] || 'application/octet-stream';
    ctx.body = fs.createReadStream(filePath);
    // 构建产物带 hash，可缓存；index.html 不缓存
    if (path.basename(filePath) === 'index.html') {
        ctx.set('Cache-Control', 'no-cache');
    } else if (ext === '.js' || ext === '.css' || ext === '.woff2') {
        ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    return true;
}

/**
 * 注册 Web 设置页路由（挂在 Koa HTTP 端口上；与 eventTransport 无关，websocket 模式也可用）
 *
 * SPA:  GET /settings  /settings/*   → public/settings（Vue3 构建产物）
 * API:  GET  /api/settings/auth
 *       GET  /api/settings/config
 *       PUT  /api/settings/config
 *       POST /api/settings/config
 */
export function registerSettingsRoutes(router: Router): void {
    // API 优先
    router.get('/api/settings/auth', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        ctx.body = {
            ok: true,
            botType: typeof botType !== 'undefined' ? botType : null,
            devEnv: typeof devEnv !== 'undefined' ? devEnv : false,
        };
    });

    router.get('/api/settings/config', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        try {
            const raw = readRawConfigFile();
            const config = normalizeRawConfigPaths(raw);
            const rootPathResolved = resolveRootPath(config);
            ctx.body = {
                config,
                rootPathResolved,
                schema: readSettingsSchema(),
                configPath: getConfigFilePath(),
                botType: typeof botType !== 'undefined' ? botType : null,
                devEnv: typeof devEnv !== 'undefined' ? devEnv : false,
            };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { message: `读取配置失败: ${(err as Error).message}` };
        }
    });

    /** AI 独立配置（config/ai.json 扁平：activeBot/dsKey/chatbot/mongo） */
    router.get('/api/settings/ai', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        try {
            const ai = readRawAIConfigFile();
            // 宿主候选列表来自 settings.json 的 bots 键
            let botNames: string[] = [];
            try {
                botNames = Object.keys(readRawConfigFile().bots || {});
            } catch {
                botNames = [];
            }
            ctx.body = {
                config: ai,
                botNames,
                schema: readAISchema(),
                configPath: getAIConfigFilePath(),
                botType: typeof botType !== 'undefined' ? botType : null,
                devEnv: typeof devEnv !== 'undefined' ? devEnv : false,
            };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { message: `读取 AI 配置失败: ${(err as Error).message}` };
        }
    });

    /** JSON Schema（字段说明 / 校验，替代文件内注释） */
    router.get('/api/settings/schema', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        const schema = readSettingsSchema();
        if (!schema) {
            ctx.status = 404;
            ctx.body = { message: 'settings.schema.json 不存在' };
            return;
        }
        ctx.body = schema;
    });

    /** 预览 rootPath + child 拼接结果 */
    router.post('/api/settings/preview-path', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        try {
            const body = (ctx.request.body || {}) as {
                rootPath?: string;
                child?: string;
            };
            const joined = previewJoinedPath(body.rootPath ?? '', body.child ?? '');
            ctx.body = {
                ok: true,
                joined,
                rootPathResolved: resolveRootPath({
                    rootPath: body.rootPath ?? '',
                } as AppConfigFile),
            };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { message: `预览失败: ${(err as Error).message}` };
        }
    });

    router.put('/api/settings/config', saveConfigHandler);
    router.post('/api/settings/config', saveConfigHandler);
    router.put('/api/settings/ai', saveAIConfigHandler);
    router.post('/api/settings/ai', saveAIConfigHandler);

    // —— 表情包图库管理（chatSticker）——
    router.get('/api/settings/stickers', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        try {
            if (!aiDb()) {
                ctx.status = 503;
                ctx.body = { message: 'AI MongoDB 未连接（chatSticker 集合不可用）' };
                return;
            }
            const q = String(ctx.query.q || '').trim();
            const status = String(ctx.query.status || '').trim();
            const page = Math.max(1, Number(ctx.query.page) || 1);
            const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize) || 24));
            const col = chatCollection(CHAT_COLLECTION.sticker);
            const filter: Record<string, unknown> = {};
            if (status) filter.status = status;
            if (q)
                filter.$or = [
                    { summary: { $regex: q, $options: 'i' } },
                    { tags: { $regex: q, $options: 'i' } },
                    { cosKey: { $regex: q, $options: 'i' } },
                ];
            const [total, list] = await Promise.all([
                col.countDocuments(filter),
                col
                    .find(filter)
                    .sort({ ts: -1 })
                    .skip((page - 1) * pageSize)
                    .limit(pageSize)
                    .toArray(),
            ]);
            const stats: Record<string, number> = {};
            for (const s of STICKER_STATUSES) {
                stats[s] = await col.countDocuments({ status: s });
            }
            stats.total = total;
            ctx.body = {
                total,
                page,
                pageSize,
                stats,
                list: list.map((d) => ({
                    _id: String(d._id),
                    summary: d.summary || '',
                    tags: d.tags || [],
                    status: d.status || 'ready',
                    nsfwRisk: d.nsfwRisk || 'low',
                    isMeme: !!d.isMeme,
                    width: d.width,
                    height: d.height,
                    byteSize: d.byteSize,
                    useCount: d.useCount || 0,
                    ts: d.ts ? new Date(d.ts).toISOString() : null,
                    groupOpenid: d.groupOpenid || '',
                    captureAuthorId: d.captureAuthorId || '',
                    imageUrl: d.cosKey ? cosUrl(d.cosKey, '') : '',
                })),
            };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { message: `图库查询失败: ${(err as Error).message}` };
        }
    });

    router.post('/api/settings/stickers/status', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        try {
            if (!aiDb()) {
                ctx.status = 503;
                ctx.body = { message: 'AI MongoDB 未连接' };
                return;
            }
            const body = (ctx.request.body || {}) as { _id?: string; status?: string };
            if (!body._id || !STICKER_STATUSES.has(body.status || '')) {
                ctx.status = 400;
                ctx.body = { message: `status 必须是 ${[...STICKER_STATUSES].join('/')}` };
                return;
            }
            const col = chatCollection(CHAT_COLLECTION.sticker);
            const res = await col.updateOne(
                { _id: body._id },
                { $set: { status: body.status, statusUpdatedAt: new Date() } },
            );
            if (!res.matchedCount) {
                ctx.status = 404;
                ctx.body = { message: '图库条目不存在' };
                return;
            }
            ctx.body = { ok: true, _id: body._id, status: body.status };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { message: `更新状态失败: ${(err as Error).message}` };
        }
    });

    /** 编辑摘要 / 标签（人工校对 vision 打标结果） */
    router.post('/api/settings/stickers/update', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        try {
            if (!aiDb()) {
                ctx.status = 503;
                ctx.body = { message: 'AI MongoDB 未连接' };
                return;
            }
            const body = (ctx.request.body || {}) as {
                _id?: string;
                summary?: string;
                tags?: string[] | string;
            };
            if (!body._id) {
                ctx.status = 400;
                ctx.body = { message: '_id 不能为空' };
                return;
            }
            const $set: Record<string, unknown> = { summaryUpdatedAt: new Date() };
            if (typeof body.summary === 'string') {
                const summary = body.summary.trim();
                if (!summary) {
                    ctx.status = 400;
                    ctx.body = { message: 'summary 不能为空' };
                    return;
                }
                if (summary.length > 500) {
                    ctx.status = 400;
                    ctx.body = { message: 'summary 过长（≤500）' };
                    return;
                }
                $set.summary = summary;
            }
            if (body.tags !== undefined) {
                const raw = Array.isArray(body.tags)
                    ? body.tags
                    : String(body.tags || '')
                          .split(/[,，\s]+/)
                          .filter(Boolean);
                $set.tags = raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
            }
            if (Object.keys($set).length <= 1) {
                ctx.status = 400;
                ctx.body = { message: '请提供 summary 或 tags' };
                return;
            }
            const col = chatCollection(CHAT_COLLECTION.sticker);
            const res = await col.updateOne({ _id: body._id }, { $set });
            if (!res.matchedCount) {
                ctx.status = 404;
                ctx.body = { message: '图库条目不存在' };
                return;
            }
            const doc = await col.findOne({ _id: body._id });
            ctx.body = {
                ok: true,
                _id: body._id,
                summary: doc?.summary || '',
                tags: doc?.tags || [],
            };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { message: `更新图库失败: ${(err as Error).message}` };
        }
    });

    router.post('/api/settings/stickers/delete', async (ctx) => {
        if (!requireSettingsAuth(ctx)) return;
        try {
            if (!aiDb()) {
                ctx.status = 503;
                ctx.body = { message: 'AI MongoDB 未连接' };
                return;
            }
            const body = (ctx.request.body || {}) as { ids?: string[] };
            const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
            if (!ids.length) {
                ctx.status = 400;
                ctx.body = { message: 'ids 不能为空' };
                return;
            }
            const col = chatCollection(CHAT_COLLECTION.sticker);
            const docs = await col
                .find({ _id: { $in: ids } }, { projection: { _id: 1, cosKey: 1 } })
                .toArray();
            const failed: string[] = [];
            let deleted = 0;
            for (const d of docs) {
                try {
                    if (d.cosKey) await cosDeleteObject(d.cosKey);
                } catch (err) {
                    log.error(`图库删除 COS 失败: ${d.cosKey}`, err);
                }
                const r = await col.deleteOne({ _id: d._id });
                if (r.deletedCount) deleted++;
                else failed.push(String(d._id));
            }
            const missing = ids.filter((id) => !docs.some((d) => String(d._id) === id));
            ctx.body = { ok: true, deleted, failed: [...failed, ...missing] };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { message: `删除失败: ${(err as Error).message}` };
        }
    });

    // SPA 页面与静态资源
    router.get('/settings', async (ctx) => {
        const ws = getWebSettings();
        if (!ws.enabled) {
            ctx.status = 403;
            ctx.type = 'text/plain; charset=utf-8';
            ctx.body = 'Web 设置页已禁用';
            return;
        }
        if (!fs.existsSync(SETTINGS_INDEX)) {
            ctx.status = 500;
            ctx.type = 'text/plain; charset=utf-8';
            ctx.body =
                '设置页前端未构建。请在仓库根目录执行: pnpm web:build\n产物应位于 public/settings/index.html';
            return;
        }
        sendFile(ctx, SETTINGS_INDEX);
    });

    // path-to-regexp v8：通配用 /settings/*path
    router.get('/settings/*path', async (ctx) => {
        const ws = getWebSettings();
        if (!ws.enabled) {
            ctx.status = 403;
            ctx.type = 'text/plain; charset=utf-8';
            ctx.body = 'Web 设置页已禁用';
            return;
        }
        if (!fs.existsSync(SETTINGS_DIST)) {
            ctx.status = 500;
            ctx.body = 'public/settings 不存在，请先 pnpm web:build';
            return;
        }

        const file = resolveStaticFile(ctx.path);
        if (file && sendFile(ctx, file)) return;

        // SPA fallback → index.html（前端路由预留）
        if (fs.existsSync(SETTINGS_INDEX)) {
            sendFile(ctx, SETTINGS_INDEX);
            return;
        }
        ctx.status = 404;
        ctx.body = 'Not Found';
    });
}

/** 可选中间件：记录设置页访问 */
export async function settingsAccessLog(ctx: Context, next: Next) {
    if (ctx.path.startsWith('/settings') || ctx.path.startsWith('/api/settings')) {
        if (typeof log !== 'undefined') {
            log.debug(`[web-settings] ${ctx.method} ${ctx.path} ip=${ctx.ip}`);
        }
    }
    await next();
}
