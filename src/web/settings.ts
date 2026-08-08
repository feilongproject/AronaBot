import fs from 'fs';
import path from 'path';
import Router from '@koa/router';
import type { Context, Next } from 'koa';
import {
    getConfigFilePath,
    normalizeRawConfigPaths,
    previewJoinedPath,
    readRawConfigFile,
    readSettingsSchema,
    resolveRootPath,
    writeRawConfigFile,
} from '../../config/config';

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
