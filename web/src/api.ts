const TOKEN_KEY = 'arona_settings_token';

export type SettingsMeta = {
    configPath?: string;
    botType?: string | null;
    devEnv?: boolean;
    hint?: string;
    hotReload?: {
        applied: string[];
        deferred: string[];
    };
};

export type ConfigResponse = SettingsMeta & {
    config: Record<string, unknown>;
    /** 解析后的全局 rootPath（空配置时 = cwd） */
    rootPathResolved?: string;
    /** JSON Schema（字段说明） */
    schema?: Record<string, unknown> | null;
};

function getToken(): string {
    return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string | null) {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
}

export function hasToken(): boolean {
    return Boolean(getToken());
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
    }
    const token = getToken();
    if (token) headers.set('X-Settings-Token', token);

    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message =
            (data as { message?: string; msg?: string }).message ||
            (data as { msg?: string }).msg ||
            res.statusText ||
            '请求失败';
        throw new Error(message);
    }
    return data as T;
}

export function auth() {
    return request<{ ok: boolean; botType: string | null; devEnv: boolean }>(
        '/api/settings/auth',
    );
}

export function fetchConfig() {
    return request<ConfigResponse>('/api/settings/config');
}

export function saveConfig(config: unknown) {
    return request<ConfigResponse>('/api/settings/config', {
        method: 'PUT',
        body: JSON.stringify({ config }),
    });
}

export function fetchSchema() {
    return request<Record<string, unknown>>('/api/settings/schema');
}

/**
 * 从 JSON Schema 取 description。
 * path 示例：`studentInfo`、`redis.socket.host`、`images.characters`、`bots.appID`（走 $defs.bot）
 */
export function schemaDescription(
    schema: Record<string, unknown> | null | undefined,
    propPath: string,
): string {
    if (!schema || !propPath) return '';
    const parts = propPath.split('.').filter(Boolean);
    let node: any = schema;

    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        // bots.<BotName>.xxx → 跳过实例名，用 $defs.bot
        if (p === 'bots' && parts.length > 2 && node?.properties?.bots) {
            node = (schema as any).$defs?.bot || node.properties.bots;
            // 下一节是 bot 实例名，再下一节才是字段
            if (i + 1 < parts.length) {
                i += 1; // skip AronaBot 等
            }
            continue;
        }

        const props = node?.properties;
        if (props && props[p]) {
            node = props[p];
            continue;
        }
        // 回退 $defs.bot
        const botProps = (schema as any).$defs?.bot?.properties;
        if (botProps?.[p]) {
            node = botProps[p];
            continue;
        }
        return '';
    }

    return typeof node?.description === 'string' ? node.description : '';
}
