/**
 * 配置类型定义（与 config/settings.json 对应）
 *
 * 路径约定：
 * - 磁盘：全局 rootPath 一次 + 各字段只存子路径 child 字符串
 * - 运行时：ConfigPath，toString() 时才 join(rootPath, child)
 * - 绝对 child（如 /tmp/xxx）不拼接 root
 */

/** 运行时路径（toString 才拼接） */
type ConfigPath = import('../../config/config').ConfigPath;

/** 磁盘上的原始配置（JSON 文件内容） */
interface AppConfigFile {
    /** 指向 settings.schema.json，供 IDE 补全 */
    $schema?: string;
    /** Web 设置页 */
    webSettings?: WebSettingsConfig;
    /**
     * 全局路径根，只设一次。空字符串 = process.cwd()。
     * 所有相对子路径相对此根拼接。
     */
    rootPath?: string;
    /** @deprecated 旧多根配置，加载时会尽量迁移到 rootPath + child */
    pathRoots?: {
        _path?: string;
        workspace?: string;
        workspaceData?: string;
    };
    bots: {
        AronaBot: BotConfigFile;
        PlanaBot: BotConfigFile;
        TestBot: BotConfigFile;
        [botName: string]: BotConfigFile;
    };
    hotLoadConfigs: HotLoadConfigFile[];
    hotLoadConfigsReload: HotLoadReloadConfigFile[];
    initConfig: Record<string, unknown>;
    baiduCensoring: BaiduCensoringConfig;
    mariadb: MariadbConfig;
    mongo: MongoConfig;
    redis: RedisConfig;
    cos: CosConfig;
    groupPush: GroupPushConfig;
    onebot: OnebotConfig;
    sms: SmsConfig;
    cosUrl: string;
    retryTime: number;
    /** 调试日志开关（默认 false：控制台与主日志仅 INFO 及以上）；热加载生效，无需重启 */
    debugLog?: boolean;
    /** 以下路径字段磁盘上均为子路径字符串（或兼容旧 PathRef） */
    studentNameDict: string | PathRefLegacy;
    errorMessageTemaple: string | PathRefLegacy;
    studentInfo: string | PathRefLegacy;
    gachaPoolInfo: string | PathRefLegacy;
    aliasStudentNameLocal: string | PathRefLegacy;
    studentNameAlias: string | PathRefLegacy;
    imagesOut: string | PathRefLegacy;
    handbookRoot: string | PathRefLegacy;
    extractRoot: string | PathRefLegacy;
    images: ImagesConfigFile;
    fontRoot: string | PathRefLegacy;
    aiTranslate: AiTranslateConfigFile;
    _picPath: PicPathConfigFile;
}

/** 旧版 { root, child }，仅兼容读取 */
interface PathRefLegacy {
    root?: string;
    child?: string;
    path?: string;
}

/** 运行时解析后的配置（export default） */
interface AppConfig {
    webSettings?: WebSettingsConfig;
    /** 已解析的全局根（绝对路径） */
    rootPath: string;
    bots: {
        AronaBot: BotConfig;
        PlanaBot: BotConfig;
        TestBot: BotConfig;
        [botName: string]: BotConfig;
    };
    hotLoadConfigs: HotLoadConfig[];
    hotLoadConfigsReload: HotLoadReloadConfig[];
    initConfig: Record<string, unknown>;
    baiduCensoring: BaiduCensoringConfig;
    mariadb: MariadbConfig;
    mongo: MongoConfig;
    redis: RedisConfig;
    cos: CosConfig;
    groupPush: GroupPushConfig;
    onebot: OnebotConfig;
    sms: SmsConfig;
    cosUrl: string;
    retryTime: number;
    /** 调试日志开关（默认 false：控制台与主日志仅 INFO 及以上）；热加载生效，无需重启 */
    debugLog?: boolean;
    /**
     * AI 相关配置（config/ai.json 运行时合并结果）：
     * dsKey / chatbot 已从 settings.json 迁出；aiTranslate 除外仍留在 settings.json。
     */
    ai: AIConfig;
    studentNameDict: ConfigPath;
    errorMessageTemaple: ConfigPath;
    studentInfo: ConfigPath;
    gachaPoolInfo: ConfigPath;
    aliasStudentNameLocal: ConfigPath;
    studentNameAlias: ConfigPath;
    imagesOut: ConfigPath;
    handbookRoot: ConfigPath;
    extractRoot: ConfigPath;
    images: ImagesConfig;
    fontRoot: ConfigPath;
    aiTranslate: AiTranslateConfig;
    _picPath: PicPathConfig;
}

interface WebSettingsConfig {
    enabled: boolean;
    token: string;
}

/** H2 风控门控（P3 最后配置；默认不启用；Must 触发默认不经过门控，applyToMust=true 时必过） */
interface ChatbotGateConfig {
    enabled: boolean; // 默认 false
    model: string; // 默认 Qwen3Guard-Stream-0.6B（自部署）
    baseURL: string; // 默认 http://127.0.0.1:8000（FastAPI /moderate）
    timeoutMs?: number; // 默认 10000
    /** Must（@/先导词）是否也过门控；默认 false；门控失败时 Must 放行、非 Must 静默 */
    applyToMust?: boolean;
    /** 违禁拦截时 Must 的短提示池（随机取一条；支持炸毛/傲娇等状态语气）；默认 1 条通用提示 */
    refusalMessages?: string[];
}

/** MCP 服务器配置（P3 接入；一期仅配置空间，具体 server 后续配置） */
interface ChatbotMcpServerConfig {
    name: string;
    transport: 'stdio' | 'http' | 'sse';
    url?: string;
    command?: string;
    args?: string[];
    /** 白名单 tools；未列出的不暴露给模型 */
    enabledTools?: string[];
}

interface ChatbotMcpConfig {
    enabled: boolean; // 一期默认 false，仅留配置空间
    servers: ChatbotMcpServerConfig[];
    maxToolRounds?: number; // 默认 3
}

interface BotChatbotConfig {
    /** 总开关；仅全局 activeBot 指定的 bot 进程生效 */
    enabled: boolean;
    /** 白名单群 group_openid 列表 */
    groups: string[];
    /** 猫娘人设 prompt；设置页可改，保存后热替换立即生效 */
    systemPrompt: string;
    /** 最高管理员 openid（群消息 @/识别用）；留空不启用特殊标记 */
    adminOpenid?: string;
    /** 先导词集合；匹配 `^prefix\s+`（prefix 后必须有空白） */
    mustPrefixes: string[];
    /**
     * Maybe 抽卡初始概率（默认 0.0005）。
     * 未命中每条消息累加 replyProbabilityStep，真正发出回复后重置为此值。
     */
    replyProbability: number;
    /** 每条未命中消息累计增加量（默认 0.0001） */
    replyProbabilityStep?: number;
    /**
     * @deprecated 已由抽卡累计模型替代，保留配置兼容。
     * 回复 bot 后窗口内接话概率（历史默认 0.7）
     */
    replyToBotProbability?: number;
    /** 接话窗口（秒）；默认 180 */
    replyChainWindowSec?: number;
    /** 连续接话链上限（仍用于链状态计数）；默认 5 */
    replyChainMax?: number;
    /** 决策模式；当前仅 hybrid */
    decideMode: 'hybrid';
    /** H2 风控门控（P3；Must 不过门控；noop 必记录） */
    gate?: ChatbotGateConfig;
    /** 单条用户消息最大字符数；超长 ignored 落库不调模型 */
    maxUserChars: number;
    /** 上下文硬顶 token（冻结 1_000_000） */
    maxContextTokens: number;
    /** 日常工作窗口 token */
    workingContextTokens: number;
    maxHistoryRounds: number;
    /** 压缩双条件 A：自上次压缩以来新增未归档 raw 条数阈值 */
    compressInterval: number;
    /** 压缩双条件 B：未归档 raw 估算 token 阈值（OR） */
    compressTokenThreshold: number;
    maxSummaryBlocks: number;
    /** 历史 TTL（秒） */
    historyTTL: number;
    /** @deprecated 废弃作为记忆路径；仅保留兼容，新代码不再使用 */
    memoryDir?: string | ConfigPath;
    /** DeepSeek 文本模型名 */
    chatModel: string;
    /** DeepSeek OpenAI 兼容 baseURL；缺省官方 */
    baseURL?: string;
    /** 看图模型（冻结默认 qwen3.7-plus） */
    visionModel: string;
    /** 阿里云百炼 OpenAI 兼容 baseURL */
    visionBaseURL?: string;
    /** 独立看图密钥，不复用 dsKey / aiTranslate.apiKey */
    visionApiKey: string;
    /** 自动抓取群聊图/表情入库 */
    stickerCaptureEnabled: boolean;
    /** sticker=动画表情或小尺寸静态表情包；animated_only=只处理动画表情（gif/webp）；emoji_like=只抓小图/表情比例 */
    stickerCaptureMode: 'emoji_like' | 'all_images' | 'animated_only' | 'sticker';
    /** 处理完成后是否存入图库；false=只打标不入库（调试/统计用）；默认 true */
    stickerCaptureStore?: boolean;
    /**
     * 是否自动通过审核。
     * false（默认）= 入库 status=pending，设置页人工通过后才 ready；
     * true= 抓取后直接 ready（旧行为）。
     */
    stickerAutoApprove?: boolean;
    /**
     * 表情相似去重：dHash 汉明距离阈值（0–64）。
     * ≤ 阈值视为相似不入库；默认 8；0=仅 contentHash 精确去重。
     */
    stickerDedupHamming?: number;
    /** 单张抓取上限（字节）；默认 2MB */
    stickerMaxBytes: number;
    /** 图库固化上限（ready+pending 合计）；默认 500 */
    stickerLibraryMax: number;
    /** 不抓取的用户 id 列表 */
    stickerBlacklistUserIds?: string[];
    /** 文字回复后附带图库表情的概率；默认 0.15 */
    stickerReplyProbability?: number;
    /** MCP 配置空间（P3 接入；一期默认关） */
    mcp?: ChatbotMcpConfig;
    /** 群限流：每秒 */
    rateLimitPerSecond: number;
    /** 群限流：每分钟 */
    rateLimitPerMinute: number;
    /** 用户/群冷却（秒）；Must 可放宽但仍受 1/s、10/min 硬顶 */
    cooldownSec: number;
    /**
     * 闭嘴关键词列表；用户消息命中任一词后本群暂停发送。
     * 默认：闭嘴 / 别说了 / 安静 / 不要说了 / shut up / shutup
     */
    muteKeywords?: string[];
    /** 闭嘴静默时长（秒）；默认 300（5 分钟） */
    muteDurationSec?: number;
    /** 新开启闭嘴时的确认文案；可含 {sec}/{min} 占位；留空用默认 */
    muteAckMessage?: string;
}

/** config/ai.json 磁盘形态：AI 相关配置独立文件（aiTranslate 除外） */
interface AIConfigFile {
    /** 指向 ai.schema.json，供 IDE 补全 */
    $schema?: string;
    /**
     * 全局唯一被动 AI 宿主 bot 名（AronaBot / PlanaBot / TestBot 等）。
     * 空字符串或不设 = 不启用被动 AI；任意时刻仅一个 bot 可运行 chatbot。
     */
    activeBot?: string;
    /** DeepSeek 等对话密钥（全局唯一） */
    dsKey?: string;
    /** 群聊被动 AI 闲聊参数（全局唯一一份） */
    chatbot?: BotChatbotConfig;
    /** AI 专用 MongoDB 连接 */
    mongo?: MongoConnectionConfig;
    /**
     * @deprecated 旧 per-bot 形态（bots.<name>.dsKey/chatbot/mongo）；
     * 加载时合并到顶层，新配置勿再使用。
     */
    bots?: Record<string, AIBotConfigFile>;
}

/**
 * @deprecated 旧 ai.json bots 条目；仅兼容加载。
 */
interface AIBotConfigFile {
    dsKey?: string;
    chatbot?: BotChatbotConfig;
    mongo?: MongoConnectionConfig;
}

/** ai.json 运行时形态（扁平：一份 chatbot + 一个 activeBot） */
interface AIConfig {
    /** 全局唯一被动 AI 宿主 bot；空=不启用 */
    activeBot: string;
    dsKey?: string;
    chatbot?: Omit<BotChatbotConfig, 'memoryDir'> & { memoryDir?: ConfigPath | string };
    mongo?: MongoConnectionConfig;
}

/** 事件接收传输模式 */
type EventTransport = 'webhook' | 'websocket';

interface BotConfigFile {
    appID: string;
    botUid?: string;
    token: string;
    secret?: string;
    /** @deprecated AI 配置已迁至 config/ai.json（bots.<bot>.dsKey）；存量兼容保留 */
    dsKey?: string;
    intents: string[];
    /**
     * 事件接收模式（缺省 `websocket`）：
     * - `websocket`：仅 WebSocket 收事件，不注册 Webhook；HTTP 仍监听（设置页 /ping 等）
     * - `webhook`：启用官方 Webhook 入口，同时保持 WebSocket 连接（双通道）
     */
    eventTransport?: EventTransport;
    allowMarkdown: boolean;
    allowMongo: boolean;
    mongo?: MongoConnectionConfig;
    /** HTTP 监听端口（Webhook 入口 / 设置页 / ping 等共用） */
    webhookPort: {
        prod: number;
        dev: number;
    };
    groupMap: Record<string, string>;
    meRealId: string;
    enableFullReceiveGroups: string[];
    /** @deprecated AI 配置已迁至 config/ai.json（bots.<bot>.chatbot）；存量兼容保留 */
    chatbot?: BotChatbotConfig;
}

interface BotConfig extends Omit<BotConfigFile, 'intents' | 'chatbot'> {
    intents: import('qq-bot-sdk').AvailableIntentsEventsEnum[];
    /** 运行时由 config/ai.json 合并而来（ai.json 优先，settings.json 存量兜底） */
    chatbot?: Omit<BotChatbotConfig, 'memoryDir'> & { memoryDir?: ConfigPath | string };
}

interface HotLoadConfigFile {
    /** 子路径，相对 rootPath */
    path: string | PathRefLegacy;
    type: string;
    root?: string;
    child?: string;
}

interface HotLoadConfig {
    path: ConfigPath;
    type: string;
}

interface HotLoadReloadConfigFile {
    path: string | PathRefLegacy;
    name: string;
    root?: string;
    child?: string;
}

interface HotLoadReloadConfig {
    path: ConfigPath;
    name: string;
}

interface BaiduCensoringConfig {
    APP_ID: string;
    API_KEY: string;
    SECRET_KEY: string;
}

interface MariadbConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    connectTimeout?: number;
    connectionLimit?: number;
    [key: string]: unknown;
}

interface MongoConfig {
    host: string;
    port: number;
    connectTimeoutMS?: number;
    serverSelectionTimeoutMS?: number;
    [key: string]: unknown;
}

interface MongoConnectionConfig {
    user: string;
    password: string;
    database: string;
    authSource?: string;
    [key: string]: unknown;
}

interface RedisConfig {
    socket: {
        host: string;
        port: number;
    };
    password?: string;
    database?: number;
    [key: string]: unknown;
}

interface CosConfig {
    SecretId: string;
    SecretKey: string;
    Bucket: string;
    Region: string;
    [key: string]: unknown;
}

interface GroupPushConfig {
    url: string;
    authKey: string;
    appId: string;
    llobKey: string;
}

interface OnebotConfig {
    baseUrl: string;
    localUploadPath: string;
    remoteUploadPath: string;
}

interface SmsConfig {
    AccessKey: {
        AccessKeyId: string;
        AccessKeySecret: string;
    };
    sendInfo: {
        phone: number;
        sign: string;
        template: string;
    };
}

interface ImagesConfigFile {
    gachaMask: Array<string | PathRefLegacy>;
    characters: string | PathRefLegacy;
    accuseCharacters: string | PathRefLegacy;
    firstChecker: string | PathRefLegacy;
    starBg: string | PathRefLegacy;
    star: string | PathRefLegacy;
    mainBg: string | PathRefLegacy;
    cutAris: string | PathRefLegacy;
    sponsor: string | PathRefLegacy;
    Tarot: string | PathRefLegacy;
    baLogo: string | PathRefLegacy;
}

interface ImagesConfig {
    gachaMask: ConfigPath[];
    characters: ConfigPath;
    accuseCharacters: ConfigPath;
    firstChecker: ConfigPath;
    starBg: ConfigPath;
    star: ConfigPath;
    mainBg: ConfigPath;
    cutAris: ConfigPath;
    sponsor: ConfigPath;
    Tarot: ConfigPath;
    baLogo: ConfigPath;
}

interface AiTranslateMessage {
    role: string;
    content: string;
}

interface AiTranslateConfigFile {
    apiKey: string;
    systemPromptFile?: string | PathRefLegacy;
    createParams: {
        model: string;
        max_tokens?: number;
        temperature?: number;
        stream?: boolean;
        messages: AiTranslateMessage[];
        [key: string]: unknown;
    };
}

interface AiTranslateConfig {
    apiKey: string;
    systemPromptFile?: ConfigPath;
    createParams: {
        model: string;
        max_tokens?: number;
        temperature?: number;
        stream?: boolean;
        messages: AiTranslateMessage[];
        [key: string]: unknown;
    };
}

interface PicPathConfigFile {
    font: string | PathRefLegacy;
    avatarBg: string | PathRefLegacy;
}

interface PicPathConfig {
    font: ConfigPath;
    avatarBg: ConfigPath;
}
