import chokidar from 'chokidar';
import schedule from 'node-schedule';
import { createPool } from 'mariadb';
import { createClient } from 'redis';
import { IChannel, IGuild, createOpenAPI, createWebsocket } from 'qq-bot-sdk';
import { sendToAdmin } from './libs/common';
import config from '../config/config';

export async function init() {
    log.info(`初始化: 正在加载命令设置`);
    global.commandConfig = (await import('../config/opts')).default;

    log.info(`初始化: 正在创建模块热加载监听`);
    for (const { type: hlType, path: hlPath } of config.hotLoadConfigs) {
        log.info(`初始化: 正在创建模块热加载监听: ${hlType}`);
        chokidar.watch(hlPath).on('change', async (fpath, stats) => {
            if (!devEnv && !hotLoadStatus) return;
            if (!require.cache[fpath]) return;

            hotLoadStatus--;
            const fileD = fpath.replace(_path, '').split('.')[0];
            log.mark(`热更新: ${hlType} ${fileD}`);
            delete require.cache[fpath];

            if (config.hotLoadConfigsReload.filter((v) => v.path === fpath)) {
                log.info(`重新加载: ${fpath}`);
                await import(fpath);
            }

            if (!devEnv)
                return sendToAdmin(`${devEnv} ${hlType} ${fileD} 正在进行热更新 ${hotLoadStatus}`);
        });
    }

    log.info(`初始化: 正在创建全局变量热加载监听`);
    const hotloadJson: { p: string; classVar: InstanceWithReload }[] = [];
    hotloadJson.push({ p: config.studentInfo, classVar: studentInfo });
    hotloadJson.push({ p: config.studentNameAlias, classVar: studentNameAlias });
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

    log.info(`初始化: 正在连接 mariadb 数据库`);
    const connectMariadb = async (init = true, retry = 0) => {
        global.mariadb = await createPool({
            ...config.mariadb,
            database: botType,
        })
            .getConnection()
            .catch((err) => {
                log.error(
                    (init ? '初始化: ' : '重连: ') + `mariadb 数据库连接失败, retry: ${retry}\n`,
                    err,
                );
                if (retry > 5) process.exit();
                else return connectMariadb(false, ++retry) as any;
            });
        mariadb?.on('error', (err) => {
            log.error('mariadb.error', err);
            mariadb.end();
            mariadb.release();
            connectMariadb(false);
        });
        log.info(`${init ? '初始化: ' : '重连: '}mariadb 数据库连接成功`);
    };
    if (config.bots[botType].allowMariadb) await connectMariadb();

    // log.info(`初始化: 正在连接 rabbitmq 数据库`);
    // global.mqconn = await amqp.connect("amqp://localhost");

    log.info(`初始化: 正在创建 client 与 ws`);
    global.client = createOpenAPI(config.bots[botType]);
    global.ws = createWebsocket(config.bots[botType]);
    global.ws.once('READY', async (data: IntentMessage.READY) => {
        log.mark(`ws已建立, 机器人信息: ${data.msg.user.username}(${data.msg.user.id})`);
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
        await mariadb?.end();
        await schedule.gracefulShutdown();
        process.exit(0);
    });
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
