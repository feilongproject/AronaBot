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
    redis: RedisConfig;
    cos: CosConfig;
    groupPush: GroupPushConfig;
    onebot: OnebotConfig;
    sms: SmsConfig;
    cosUrl: string;
    retryTime: number;
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
    redis: RedisConfig;
    cos: CosConfig;
    groupPush: GroupPushConfig;
    onebot: OnebotConfig;
    sms: SmsConfig;
    cosUrl: string;
    retryTime: number;
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

interface BotChatbotConfig {
    groups: string[];
    replyProbability: number;
    maxHistoryRounds: number;
    compressInterval: number;
    historyTTL: number;
    /** 磁盘为子路径；运行时 ConfigPath */
    memoryDir: string | ConfigPath;
    maxSummaryBlocks: number;
}

interface BotConfigFile {
    appID: string;
    botUid?: string;
    token: string;
    secret?: string;
    dsKey?: string;
    intents: string[];
    allowMarkdown: boolean;
    allowMariadb: boolean;
    webhookPort: {
        prod: number;
        dev: number;
    };
    groupMap: Record<string, string>;
    meRealId: string;
    enableFullReceiveGroups: string[];
    chatbot?: BotChatbotConfig;
}

interface BotConfig extends Omit<BotConfigFile, 'intents' | 'chatbot'> {
    intents: import('qq-bot-sdk').AvailableIntentsEventsEnum[];
    chatbot?: Omit<BotChatbotConfig, 'memoryDir'> & { memoryDir: ConfigPath | string };
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
