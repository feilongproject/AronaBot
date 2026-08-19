/**
 * AronaBot 配置中心（单文件）
 *
 * - 磁盘：config/settings.json（标准 JSON + $schema）
 * - 说明：config/settings.schema.json
 * - 路径：全局 rootPath 一次；字段只存子路径；运行时 ConfigPath，toString() 才 join
 * - 导出：default 为单例 AppConfig；pathStr / ConfigPath 供插件使用
 *
 * 注意：数据文件不要命名为 config.json，否则 require('.../config/config') 会解析到 JSON。
 */
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// ConfigPath：子路径 + 延迟拼接
// ---------------------------------------------------------------------------

/** 磁盘只存 child；toString / 模板字符串时才 join(root, child) */
export class ConfigPath {
    readonly root: string;
    readonly child: string;

    constructor(root: string, child: string) {
        this.root = root || '';
        this.child = child ?? '';
    }

    get isAbsoluteChild(): boolean {
        return Boolean(this.child) && path.isAbsolute(this.child);
    }

    toString(): string {
        if (!this.child) return this.root;
        if (path.isAbsolute(this.child)) return this.child;
        if (!this.root) return this.child;
        return path.join(this.root, this.child);
    }

    valueOf(): string {
        return this.toString();
    }

    [Symbol.toPrimitive](_hint?: string): string {
        return this.toString();
    }

    /** JSON.stringify 时只写子路径 */
    toJSON(): string {
        return this.child;
    }

    withRoot(root: string): ConfigPath {
        return new ConfigPath(root, this.child);
    }
}

/**
 * 解析 bot 事件接收模式。
 * - `websocket`（默认）：仅 WebSocket 收事件，不注册 Webhook（HTTP 仍用于设置页等）
 * - `webhook`：注册官方 Webhook，同时保持 WebSocket 双通道
 */
export function resolveEventTransport(
    bot?: Pick<BotConfig | BotConfigFile, 'eventTransport'> | null,
): EventTransport {
    return bot?.eventTransport === 'webhook' ? 'webhook' : 'websocket';
}

/** fs / path / sharp 等必须 string 时使用 */
export function pathStr(p: ConfigPath | string | null | undefined): string {
    if (p == null) return '';
    return typeof p === 'string' ? p : p.toString();
}

/**
 * 任意磁盘路径值 → 子路径字符串
 * 兼容：纯字符串、旧 ${workspaceData}/x、旧 { root, child }
 */
export function coerceChildPath(value: unknown): string {
    if (value == null) return '';

    if (typeof value === 'string') {
        const m = /^\$\{(_path|workspace|workspaceData)\}[/\\]?(.*)$/.exec(value);
        if (m) {
            const rest = (m[2] || '').replace(/\\/g, '/').replace(/^\.\//, '');
            if (m[1] === 'workspaceData') {
                if (!rest) return 'data';
                if (rest === 'data' || rest.startsWith('data/')) return rest;
                return `data/${rest}`;
            }
            return rest;
        }
        return value.replace(/\\/g, '/');
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
        const o = value as { root?: string; child?: string; path?: string };
        if (typeof o.child === 'string' || o.root) {
            const child = (o.child ?? '').replace(/\\/g, '/');
            const rootKey = o.root || '_path';
            if (rootKey === 'absolute') return child;
            if (rootKey === 'workspaceData') {
                if (!child) return 'data';
                if (child === 'data' || child.startsWith('data/') || path.isAbsolute(child)) {
                    return child;
                }
                return `data/${child}`;
            }
            return child.replace(/^\.\//, '');
        }
        if (typeof o.path === 'string') return coerceChildPath(o.path);
    }

    return String(value);
}

export function makeConfigPath(root: string, child: unknown): ConfigPath {
    return new ConfigPath(root, coerceChildPath(child));
}

/** 磁盘 chatbot 配置 → 运行时（memoryDir 变为 ConfigPath） */
function toRuntimeChatbot(
    chatbot: BotChatbotConfig | undefined,
    root: string,
): (Omit<BotChatbotConfig, 'memoryDir'> & { memoryDir?: ConfigPath | string }) | undefined {
    if (!chatbot) return undefined;
    const out = { ...chatbot } as Omit<BotChatbotConfig, 'memoryDir'> & {
        memoryDir?: ConfigPath | string;
    };
    if (out.memoryDir != null) out.memoryDir = makeConfigPath(root, out.memoryDir as unknown);
    return out;
}

// ---------------------------------------------------------------------------
// 文件路径
// ---------------------------------------------------------------------------

global._path = process.cwd();

const SCHEMA_REF = './settings.schema.json';
const AI_SCHEMA_REF = './ai.schema.json';

function configDir(): string {
    return path.join(global._path || process.cwd(), 'config');
}

function settingsFile(): string {
    return path.join(configDir(), 'settings.json');
}

function settingsExampleFile(): string {
    return path.join(configDir(), 'settings.example.json');
}

function settingsSchemaFile(): string {
    return path.join(configDir(), 'settings.schema.json');
}

function aiConfigFile(): string {
    return path.join(configDir(), 'ai.json');
}

function aiExampleFile(): string {
    return path.join(configDir(), 'ai.example.json');
}

function aiSchemaFile(): string {
    return path.join(configDir(), 'ai.schema.json');
}

export function getConfigFilePath(): string {
    return settingsFile();
}

export function getSettingsSchemaPath(): string {
    return settingsSchemaFile();
}

export function getAIConfigFilePath(): string {
    return aiConfigFile();
}

export function getAISchemaPath(): string {
    return aiSchemaFile();
}

// ---------------------------------------------------------------------------
// 路径字段清单（磁盘归一化 / 运行时包装共用）
// ---------------------------------------------------------------------------

const TOP_PATH_KEYS = [
    'studentNameDict',
    'errorMessageTemaple',
    'studentInfo',
    'gachaPoolInfo',
    'aliasStudentNameLocal',
    'studentNameAlias',
    'imagesOut',
    'handbookRoot',
    'extractRoot',
    'fontRoot',
] as const;

const IMAGE_PATH_KEYS = [
    'characters',
    'accuseCharacters',
    'firstChecker',
    'starBg',
    'star',
    'mainBg',
    'cutAris',
    'sponsor',
    'Tarot',
    'baLogo',
] as const;

function cloneJson<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

/** 热加载项 path 字段兼容 root/child 旧形态 */
function hotItemPath(item: { path?: unknown; root?: string; child?: string }): unknown {
    if (item.root != null) {
        return { root: item.root, child: item.child ?? item.path };
    }
    return item.path;
}

// ---------------------------------------------------------------------------
// rootPath
// ---------------------------------------------------------------------------

/** 解析全局 rootPath：空 / 未设 = cwd；兼容旧 pathRoots._path */
export function resolveRootPath(fileData: Pick<AppConfigFile, 'rootPath' | 'pathRoots'>): string {
    const raw = (fileData.rootPath ?? '').trim() || (fileData.pathRoots?._path ?? '').trim();
    const cwd = global._path || process.cwd();
    if (!raw) return cwd;
    return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

/** 预览：root + child → 绝对路径（设置页） */
export function previewJoinedPath(rootPathInput: string, child: string): string {
    const cwd = global._path || process.cwd();
    const root = rootPathInput.trim()
        ? path.isAbsolute(rootPathInput)
            ? rootPathInput
            : path.resolve(cwd, rootPathInput)
        : cwd;
    return makeConfigPath(root, child).toString();
}

// ---------------------------------------------------------------------------
// 磁盘形态 ↔ 运行时形态
// ---------------------------------------------------------------------------

/**
 * 磁盘编辑形态：路径全是子路径字符串，去掉 pathRoots，保证 rootPath 字段存在
 */
export function normalizeRawConfigPaths(raw: AppConfigFile): AppConfigFile {
    const data = cloneJson(raw);

    if (data.rootPath == null || data.rootPath === '') {
        data.rootPath = data.pathRoots?._path?.trim() || '';
    }
    delete data.pathRoots;
    delete (data as { $schema?: string }).$schema;

    for (const key of TOP_PATH_KEYS) {
        (data as any)[key] = coerceChildPath((data as any)[key]);
    }

    if (!data.images) data.images = {} as ImagesConfigFile;
    data.images.gachaMask = Array.isArray(data.images.gachaMask)
        ? data.images.gachaMask.map((v) => coerceChildPath(v))
        : [];
    for (const k of IMAGE_PATH_KEYS) {
        (data.images as any)[k] = coerceChildPath((data.images as any)[k]);
    }

    if (!data._picPath) data._picPath = { font: '', avatarBg: '' };
    data._picPath.font = coerceChildPath(data._picPath.font);
    data._picPath.avatarBg = coerceChildPath(data._picPath.avatarBg);

    if (data.aiTranslate?.systemPromptFile != null) {
        data.aiTranslate.systemPromptFile = coerceChildPath(data.aiTranslate.systemPromptFile);
    }

    data.hotLoadConfigs = (data.hotLoadConfigs || []).map((item) => ({
        path: coerceChildPath(hotItemPath(item)),
        type: item.type,
    }));

    data.hotLoadConfigsReload = (data.hotLoadConfigsReload || []).map((item) => ({
        path: coerceChildPath(hotItemPath(item)),
        name: item.name,
    }));

    if (data.bots) {
        for (const bot of Object.values(data.bots)) {
            if (bot?.chatbot?.memoryDir != null) {
                bot.chatbot.memoryDir = coerceChildPath(bot.chatbot.memoryDir);
            }
        }
    }

    return data;
}

/** 磁盘 JSON → 运行时（路径字段变为 ConfigPath） */
function buildRuntimeConfig(fileData: AppConfigFile): AppConfig {
    const root = resolveRootPath(fileData);
    const out = cloneJson(fileData) as unknown as AppConfig & Record<string, any>;

    out.rootPath = root;
    delete out.pathRoots;
    delete out.$schema;

    for (const key of TOP_PATH_KEYS) {
        out[key] = makeConfigPath(root, (fileData as any)[key]);
    }

    const img = fileData.images || ({} as ImagesConfigFile);
    out.images = {
        gachaMask: Array.isArray(img.gachaMask)
            ? img.gachaMask.map((v) => makeConfigPath(root, v))
            : [],
        characters: makeConfigPath(root, img.characters),
        accuseCharacters: makeConfigPath(root, img.accuseCharacters),
        firstChecker: makeConfigPath(root, img.firstChecker),
        starBg: makeConfigPath(root, img.starBg),
        star: makeConfigPath(root, img.star),
        mainBg: makeConfigPath(root, img.mainBg),
        cutAris: makeConfigPath(root, img.cutAris),
        sponsor: makeConfigPath(root, img.sponsor),
        Tarot: makeConfigPath(root, img.Tarot),
        baLogo: makeConfigPath(root, img.baLogo),
    };

    const pic = fileData._picPath || ({} as PicPathConfigFile);
    out._picPath = {
        font: makeConfigPath(root, pic.font),
        avatarBg: makeConfigPath(root, pic.avatarBg),
    };

    out.hotLoadConfigs = (fileData.hotLoadConfigs || []).map((item) => ({
        path: makeConfigPath(root, hotItemPath(item)),
        type: item.type,
    }));

    out.hotLoadConfigsReload = (fileData.hotLoadConfigsReload || []).map((item) => ({
        path: makeConfigPath(root, hotItemPath(item)),
        name: item.name,
    }));

    if (fileData.aiTranslate) {
        out.aiTranslate = {
            ...fileData.aiTranslate,
            systemPromptFile: fileData.aiTranslate.systemPromptFile
                ? makeConfigPath(root, fileData.aiTranslate.systemPromptFile)
                : undefined,
            createParams: { ...fileData.aiTranslate.createParams },
        };
    }

    if (out.bots) {
        for (const bot of Object.values(out.bots)) {
            if (!bot) continue;
            // 非法值回落 webhook，保证启动路径可预期
            bot.eventTransport = resolveEventTransport(bot);
            bot.chatbot = toRuntimeChatbot(bot.chatbot, root);
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// env 注入
// ---------------------------------------------------------------------------

function injectConfigToEnv(obj: unknown, prefix = 'ARONA'): void {
    if (obj === null || obj === undefined) return;

    if (obj instanceof ConfigPath) {
        process.env[prefix] = obj.toString();
        return;
    }
    if (typeof obj !== 'object') {
        process.env[prefix] = String(obj);
        return;
    }
    if (Array.isArray(obj)) {
        process.env[prefix] = JSON.stringify(
            obj.map((v) => (v instanceof ConfigPath ? v.toString() : v)),
        );
        return;
    }

    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const envKey = `${prefix}_${key.toUpperCase()}`;
        if (val instanceof ConfigPath) {
            process.env[envKey] = val.toString();
        } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            injectConfigToEnv(val, envKey);
        } else if (Array.isArray(val)) {
            process.env[envKey] = JSON.stringify(
                val.map((v) => (v instanceof ConfigPath ? v.toString() : v)),
            );
        } else if (val !== null && val !== undefined) {
            process.env[envKey] = String(val);
        }
    }
}

function applyEnvFromConfig(resolved: AppConfig, settingsPath: string): void {
    process.env.WORKSPACE = resolved.rootPath;
    process.env.ARONA_WORKSPACE = resolved.rootPath;
    process.env.ARONA_WORKSPACE_DATA = path.join(resolved.rootPath, 'data');
    process.env.ARONA__PATH = resolved.rootPath;
    process.env.ARONA_CONFIG_FILE = settingsPath;
    process.env.ARONA_ROOT_PATH = resolved.rootPath;
    global._path = resolved.rootPath;
    injectConfigToEnv(resolved, 'ARONA');
}

function injectSystemPrompt(resolved: AppConfig): void {
    if (!resolved.aiTranslate?.systemPromptFile) return;
    const promptPath = pathStr(resolved.aiTranslate.systemPromptFile);
    if (!fs.existsSync(promptPath)) return;
    const prompt = fs.readFileSync(promptPath, 'utf-8');
    const messages = resolved.aiTranslate.createParams?.messages;
    if (!Array.isArray(messages)) return;
    const sys = messages.find((m) => m.role === 'system');
    if (sys) sys.content = prompt;
    else messages.unshift({ role: 'system', content: prompt });
}

// ---------------------------------------------------------------------------
// 读写磁盘
// ---------------------------------------------------------------------------

export function readRawConfigFile(): AppConfigFile {
    const file = settingsFile();
    if (!fs.existsSync(file)) {
        throw new Error(`[config] 配置文件不存在: ${file}`);
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as AppConfigFile;
    } catch (err) {
        throw new Error(`[config] 解析 settings.json 失败: ${(err as Error).message}`);
    }
}

export function readSettingsSchema(): Record<string, unknown> | null {
    const p = settingsSchemaFile();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
}

export function readAISchema(): Record<string, unknown> | null {
    const p = aiSchemaFile();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
}

export function readRawAIConfigFile(): AIConfigFile {
    const file = aiConfigFile();
    if (!fs.existsSync(file)) {
        throw new Error(`[config] AI 配置文件不存在: ${file}`);
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as AIConfigFile;
    } catch (err) {
        throw new Error(`[config] 解析 ai.json 失败: ${(err as Error).message}`);
    }
}

/** 首次运行：ai.json 不存在时从 ai.example.json 复制 */
function seedAIConfigIfMissing(): void {
    const file = aiConfigFile();
    if (fs.existsSync(file)) return;
    const ex = aiExampleFile();
    if (fs.existsSync(ex)) {
        fs.copyFileSync(ex, file);
        // eslint-disable-next-line no-console
        console.warn(`[config] 未找到 ai.json，已从 ai.example.json 复制，请填写 AI 密钥`);
        return;
    }
    throw new Error(`[config] 缺少 ${file}，且无 ai.example.json 可复制，请先创建 AI 配置文件`);
}

/** 读取 ai.json 并构建运行时形态（memoryDir 等路径字段包装） */
function loadAIConfigFromDisk(root: string): AIConfig {
    const raw = readRawAIConfigFile();
    return {
        activeBot: String(raw.activeBot || '').trim(),
        chatbot: toRuntimeChatbot(raw.chatbot, root),
        mongo: raw.mongo,
    };
}

/** 把 ai.json 合并进运行时 config：ai.json 优先；chatbot 挂到 activeBot 供兼容读取 */
function overlayAIConfig(resolved: AppConfig, ai: AIConfig): void {
    (resolved as { ai?: AIConfig }).ai = ai;
    const owner = ai.activeBot;
    if (owner && resolved.bots[owner] && ai.chatbot != null) {
        resolved.bots[owner].chatbot = ai.chatbot as BotConfig['chatbot'];
    }
}

export function loadConfigFromDisk(): AppConfig {
    const file = settingsFile();
    if (!fs.existsSync(file)) {
        const ex = settingsExampleFile();
        if (fs.existsSync(ex)) {
            fs.copyFileSync(ex, file);
            // eslint-disable-next-line no-console
            console.warn(
                `[config] 未找到 settings.json，已从 settings.example.json 复制，请填写密钥后重启`,
            );
        } else {
            throw new Error(
                `[config] 缺少 ${file}，且无 settings.example.json 可复制，请先创建配置文件`,
            );
        }
    }

    const fileData = readRawConfigFile();
    seedAIConfigIfMissing();
    const resolved = buildRuntimeConfig(fileData);
    overlayAIConfig(resolved, loadAIConfigFromDisk(resolved.rootPath));
    injectSystemPrompt(resolved);
    applyEnvFromConfig(resolved, file);
    return resolved;
}

export function replaceConfigInPlace(next: AppConfig): void {
    const target = config as unknown as Record<string, unknown>;
    const source = next as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) {
        if (!(key in source)) delete target[key];
    }
    Object.assign(target, source);
}

export function reloadConfigFromDisk(): AppConfig {
    replaceConfigInPlace(loadConfigFromDisk());
    return config;
}

export type ConfigHotReloadResult = {
    applied: string[];
    deferred: string[];
};

/** 保存后可热更新的副作用（端口 / intents / 已建连接等仍需重启） */
export function applyConfigRuntimeHooks(): ConfigHotReloadResult {
    const applied: string[] = [];
    const deferred = [
        'eventTransport（Webhook/WebSocket 事件入口，需重启切换）',
        'webhookPort（进程已监听的端口）',
        'intents（启动时注册的事件监听）',
        'redis / mongo（已建立的连接）',
        'bot token/secret（OpenAPI client）',
    ];

    try {
        const g = globalThis as typeof globalThis & {
            botType?: string;
            allowMarkdown?: boolean;
            meAppId?: string;
            cos?: unknown;
            log?: { mark?: (msg: string) => void; error?: (...args: unknown[]) => void };
        };

        if (g.botType && config.bots?.[g.botType]) {
            const bot = config.bots[g.botType];
            g.allowMarkdown = bot.allowMarkdown;
            applied.push('allowMarkdown');
            if (bot.appID) {
                g.meAppId = bot.appID;
                applied.push('meAppId');
            }
        }

        const imagesOut = pathStr(config.imagesOut);
        if (imagesOut) {
            if (!fs.existsSync(imagesOut)) fs.mkdirSync(imagesOut, { recursive: true });
            applied.push('imagesOut');
        }

        if (config.cos && typeof g.cos !== 'undefined') {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const COS = require('cos-nodejs-sdk-v5');
                g.cos = new COS(config.cos);
                applied.push('cos client');
            } catch (err) {
                g.log?.error?.('[config] 热更新 COS 客户端失败', err);
            }
        }

        g.log?.mark?.(
            `[config] 热加载完成 applied=[${applied.join(', ')}] deferred=[${deferred.join('; ')}]`,
        );
    } catch (err) {
        try {
            (globalThis as { log?: { error?: (...a: unknown[]) => void } }).log?.error?.(
                '[config] applyConfigRuntimeHooks 异常',
                err,
            );
        } catch {
            // ignore
        }
    }

    return { applied, deferred };
}

/** 写入 settings.json（带 $schema）并热替换内存配置 */
export function writeRawConfigFile(data: AppConfigFile | unknown): ConfigHotReloadResult {
    const file = settingsFile();
    const normalized =
        data && typeof data === 'object'
            ? normalizeRawConfigPaths(data as AppConfigFile)
            : ({} as AppConfigFile);

    const ordered: Record<string, unknown> = { $schema: SCHEMA_REF };
    for (const [k, v] of Object.entries(normalized as object as Record<string, unknown>)) {
        if (k === '$schema') continue;
        ordered[k] = v;
    }

    const text = JSON.stringify(ordered, null, 4);
    JSON.parse(text); // 校验可序列化

    const dir = configDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text + '\n', 'utf-8');
    fs.renameSync(tmp, file);

    reloadConfigFromDisk();
    return applyConfigRuntimeHooks();
}

/** 写入 ai.json（带 $schema）并热替换内存中的 AI 配置 */
export function writeRawAIConfigFile(data: unknown): ConfigHotReloadResult {
    const file = aiConfigFile();
    const normalized = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    const ordered: Record<string, unknown> = { $schema: AI_SCHEMA_REF };
    for (const [k, v] of Object.entries(normalized)) {
        if (k === '$schema') continue;
        ordered[k] = v;
    }

    const text = JSON.stringify(ordered, null, 4);
    JSON.parse(text); // 校验可序列化

    const dir = configDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text + '\n', 'utf-8');
    fs.renameSync(tmp, file);

    reloadAIConfigFromDisk();
    return applyConfigRuntimeHooks();
}

/** 重新读取 ai.json 并覆盖内存中的 AI 配置（chatbot.apiKey / baseURL 立即生效） */
export function reloadAIConfigFromDisk(): AIConfig {
    const ai = loadAIConfigFromDisk(config.rootPath);
    overlayAIConfig(config, ai);
    return ai;
}

// ---------------------------------------------------------------------------
// 单例
// ---------------------------------------------------------------------------

const config: AppConfig = loadConfigFromDisk();
export default config;
