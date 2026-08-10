import chokidar from 'chokidar';
import schedule from 'node-schedule';
import { MongoClient } from 'mongodb';
import { createClient } from 'redis';
import { IChannel, IGuild, createOpenAPI, createWebsocket } from 'qq-bot-sdk';
import { sendToAdmin } from './libs/common';
import config, { pathStr, resolveEventTransport } from '../config/config';

export async function init() {
    log.info(`初始化: 正在加载命令设置`);
    global.commandConfig = (await import('../config/opts')).default;
    validateChatbotFullReceive();

    log.info(`初始化: 正在创建模块热加载监听`);
    for (const { type: hlType, path: hlPath } of config.hotLoadConfigs) {
        log.info(`初始化: 正在创建模块热加载监听: ${hlType}`);
        const watchPath = pathStr(hlPath);
        chokidar.watch(watchPath).on('change', async (fpath, stats) => {
            if (!devEnv && !hotLoadStatus) return;
            if (!require.cache[fpath]) return;

            hotLoadStatus--;
            const fileD = fpath.replace(_path, '').split('.')[0];
            log.mark(`热更新: ${hlType} ${fileD}`);
            delete require.cache[fpath];

            if (config.hotLoadConfigsReload.some((v) => pathStr(v.path) === fpath)) {
                log.info(`重新加载: ${fpath}`);
                await import(fpath);
            }

            if (!devEnv)
                return sendToAdmin(`${devEnv} ${hlType} ${fileD} 正在进行热更新 ${hotLoadStatus}`);
        });
    }

    log.info(`初始化: 正在创建全局变量热加载监听`);
    const hotloadJson: { p: string; classVar: InstanceWithReload }[] = [];
    hotloadJson.push({ p: pathStr(config.studentInfo), classVar: studentInfo });
    hotloadJson.push({ p: pathStr(config.studentNameAlias), classVar: studentNameAlias });
    for (const { p, classVar } of hotloadJson) {
        const constructorName = Object.getPrototypeOf(classVar).constructor.name;
        log.info(`初始化: 正在创建全局变量热加载监听: ${constructorName}`);
        chokidar.watch(p).on('change', async (filepath, stats) => {
            log.mark(`${constructorName} 正在进行热更新`);
            classVar.reload();
        });
    }

    log.info(`初始化: 正在连接 redis 数据库`);
    const connectRedis = async (init = true, retry = 0) => {
        global.redis = createClient(config.redis);
        await global.redis
            .connect()
            .then(() => redis.ping())
            .then((pong) => {
                log.info((init ? '初始化: ' : '重连: ') + `redis 数据库连接成功 ${pong}`);
            })
            .catch((err) => {
                log.error(
                    (init ? '初始化: ' : '重连: ') + `redis 数据库连接失败， retry: ${retry}\n`,
                    err,
                );
                if (retry > 5) process.exit();
                else return connectRedis(false, ++retry) as any;
            });

        redis.on('error', (err) => {
            log.error(err);
        });
    };
    await connectRedis();

    log.info(`初始化: 正在连接 mongodb 数据库`);
    const connectMongo = async (init = true, retry = 0): Promise<void> => {
        const botMongo = config.bots[botType].mongo;
        if (!botMongo) {
            log.error('初始化: 未配置 bots[botType].mongo, 跳过 mongodb 连接');
            return;
        }
        const authSource = botMongo.authSource || botMongo.database;
        const uri = `mongodb://${encodeURIComponent(botMongo.user)}:${encodeURIComponent(
            botMongo.password,
        )}@${config.mongo.host}:${config.mongo.port}/${botMongo.database}?authSource=${encodeURIComponent(
            authSource,
        )}`;
        global.mongo = new MongoClient(uri, {
            connectTimeoutMS: config.mongo.connectTimeoutMS,
            serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
        });
        try {
            await global.mongo.connect();
            global.mongoDb = global.mongo.db(botMongo.database);
            log.info(`${init ? '初始化: ' : '重连: '}mongodb 数据库连接成功 ${botMongo.database}`);
        } catch (err) {
            log.error(
                (init ? '初始化: ' : '重连: ') + `mongodb 数据库连接失败, retry: ${retry}\n`,
                err,
            );
            if (retry > 5) process.exit();
            else return connectMongo(false, ++retry);
        }
        global.mongo.on('error', (err) => {
            log.error('mongodb.error', err);
        });
    };
    if (config.bots[botType].allowMongo) {
        await connectMongo();
    }

    // 全局 AI 宿主 bot：AI 专用 MongoDB（config/ai.json 顶层 mongo）
    const aiOwner = String(config.ai?.activeBot || '').trim();
    if (aiOwner && botType === aiOwner) {
        const aiMongoCfg = config.ai?.mongo;
        if (aiMongoCfg) {
            await connectAIMongo(aiMongoCfg);
        } else {
            log.warn('未配置 AI 专用 MongoDB（ai.json mongo），chatbot 数据回落主库');
        }
        if (global.aiMongoDb || global.mongoDb) {
            // 建 chatContext / chatMemory / chatSticker / chatNoop 索引
            await import('./plugins/chatbot/db')
                .then((m) => m.ensureChatbotIndexes())
                .catch((err) => log.error('ensureChatbotIndexes failed', err));
        }
    }

    // log.info(`初始化: 正在连接 rabbitmq 数据库`);
    // global.mqconn = await amqp.connect("amqp://localhost");

    const eventTransport = resolveEventTransport(config.bots[botType]);
    log.info(`初始化: 正在创建 client 与 ws（eventTransport=${eventTransport}）`);
    global.client = createOpenAPI(config.bots[botType]);
    // webhook / websocket 模式均保持 WebSocket：
    // - webhook：官方 Webhook 注入 + WS 双通道（eventId 去重）
    // - websocket：仅 WS 收事件
    global.ws = createWebsocket({ ...config.bots[botType], sandbox: devEnv });
    global.ws.once('READY', async (data: IntentMessage.READY) => {
        log.mark(`ws已建立, 机器人信息: ${data.msg.user.username}(${data.msg.user.id})`);
    });
    global.ws.on('ERROR', (err) => {
        log.error(`ws错误`, err);
        // process.exit(1);
    });

    log.info(`初始化: 正在创建频道树`);
    await loadGuildTree(true);

    await global.client.meApi.me().then((res) => (global.meId = res.data.id));
    global.meRealId = config.bots[botType].meRealId;

    await import('./plugins/studentInfo')
        .then((module) => module.reloadStudentInfo('local'))
        .then((d) => {
            log.info(`学生数据加载完毕 ${d}`);
        });

    log.info(`初始化: 正在注册定时任务`);
    await import('./plugins/schedule');

    if (await redis.exists(`isRestart:${meId}`)) {
        await redis.del(`isRestart:${meId}`);
        return sendToAdmin(`${botType} 重启成功`).catch(() => {});
    } else if (!devEnv) return sendToAdmin(`${botType} 启动成功`).catch(() => {});

    log.info('初始化: 正在注册SIGINT');
    process.on('SIGINT', async () => {
        await global.browser?.close();
        await mongo?.close();
        await aiMongo?.close();
        await schedule.gracefulShutdown();
        process.exit(0);
    });
}

/** AI 专用 MongoDB（ai.json 顶层 mongo） */
async function connectAIMongo(
    aiMongoCfg: NonNullable<AIConfig['mongo']>,
    retry = 0,
): Promise<void> {
    if (!aiMongoCfg) return;
    const authSource = aiMongoCfg.authSource || aiMongoCfg.database;
    const uri = `mongodb://${encodeURIComponent(aiMongoCfg.user)}:${encodeURIComponent(
        aiMongoCfg.password,
    )}@${config.mongo.host}:${config.mongo.port}/${aiMongoCfg.database}?authSource=${encodeURIComponent(
        authSource,
    )}`;
    global.aiMongo = new MongoClient(uri, {
        connectTimeoutMS: config.mongo.connectTimeoutMS,
        serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
    });
    try {
        await global.aiMongo.connect();
        global.aiMongoDb = global.aiMongo.db(aiMongoCfg.database);
        log.info(`初始化: AI mongodb 连接成功 ${aiMongoCfg.database}（${aiMongoCfg.user}）`);
    } catch (err) {
        log.error(`初始化: AI mongodb 连接失败, retry: ${retry}\n`, err);
        if (retry > 5) process.exit();
        else return connectAIMongo(aiMongoCfg, ++retry);
    }
    global.aiMongo.on('error', (err) => {
        log.error('aiMongo.error', err);
    });
}

/**
 * 启动校验：chatbot 白名单群必须配置 enableFullReceiveGroups（按 group_openid）。
 * 仅告警，不静默改行为。
 */
function validateChatbotFullReceive() {
    const cfg = config.bots[botType]?.chatbot;
    if (!cfg?.enabled || !cfg.groups?.length) return;
    const full = config.bots[botType]?.enableFullReceiveGroups || [];
    const missing = cfg.groups.filter((g) => !full.includes(g));
    if (missing.length) {
        log.warn(
            `chatbot 白名单群未配置 enableFullReceiveGroups 全量接收（group_openid），` +
                `将无法稳定入站: ${missing.join(', ')}`,
        );
    }
}

/**
 * 远古产物，能跑就不要动
 * @param init true就是初始化，要不然就是更新
 */
export async function loadGuildTree(init?: boolean): Promise<any>;
export async function loadGuildTree(init: IChannel | IGuild): Promise<any>;
export async function loadGuildTree(init?: boolean | IChannel | IGuild): Promise<any> {
    if (!global.saveGuildsTree) global.saveGuildsTree = {};

    if (typeof init == 'object') {
        if ('member_count' in init) {
            if (global.saveGuildsTree[init.id])
                return (saveGuildsTree[init.id] = {
                    ...init,
                    channels: saveGuildsTree[init.id].channels,
                });
            const guildInfo = await getGuildInfo(init);
            if (!guildInfo) return log.error(`频道 ${init.name}(${init.id}) 信息获取失败`);
            return (saveGuildsTree[init.id] = guildInfo);
        }
        if ('position' in init && saveGuildsTree[init.guild_id])
            saveGuildsTree[init.guild_id].channels[init.id] = init;
        return;
    }

    // 大抵是似了，姑且活着，要不是兼容频道数据早没了
    const guildData = await client.meApi
        .meGuilds()
        .then((res) => res.data)
        .catch((err) => log.error(err));
    if (!guildData) return;
    for (const guild of guildData) {
        if (init === true) log.mark(`${guild.name}(${guild.id})`);
        const guildInfo = await getGuildInfo(guild);
        if (!guildInfo) continue;
        global.saveGuildsTree[guild.id] = guildInfo;
    }
}

/**
 * 亻尔女子
 * @param gInfo 你是？
 * @returns 早忘完了
 */
async function getGuildInfo(gInfo: IGuild): Promise<SaveGuild> {
    const guildInfo: SaveGuild = { ...gInfo, channels: {} };
    const channelData = await client.channelApi
        .channels(gInfo.id)
        .then((res) => res.data)
        .catch((err) => {});
    if (!channelData) return guildInfo;
    for (const channel of channelData) {
        // if (init) log.mark(`${guild.name}(${guild.id})-${channel.name}(${channel.id})-father:${channel.parent_id}`);
        guildInfo.channels[channel.id] = { ...channel };
    }
    return guildInfo;
}
