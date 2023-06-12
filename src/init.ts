import chokidar from "chokidar";
import { createPool } from 'mariadb';
import { createClient } from 'redis';
import schedule from "node-schedule";
import { createOpenAPI, createWebsocket } from 'qq-guild-bot';
import _log from './libs/logger';
import { reloadStudentInfo } from './libs/common';
import config from '../config/config.json';

export async function init() {

    console.log(`机器人准备运行，正在初始化`);

    global.adminId = ["7681074728704576201", "15874984758683127001"];
    global.log = _log;
    global._path = process.cwd();
    global.botStatus = {
        startTime: new Date(),
        msgSendNum: 0,
        imageRenderNum: 0,
    }
    global.hotLoadStatus = false;

    if (process.argv.includes("--dev")) {
        global.devEnv = true;
        log.mark("当前环境处于开发环境，请注意！");
    } else global.devEnv = false;

    //log.info(`初始化：正在创建定时任务`);
    //schedule.scheduleJob("0 * * * * ? ", async () => (await import("./plugins/biliDynamic")).taskPushBili());
    schedule.scheduleJob("0 * * * * ? ", async () => {
        if (devEnv) {
            // log.debug(`当前正在测试环境`);
            await redis.setEx("devEnv", 60, "1");
        } else {
            log.mark(`保存数据库中`);
            await redis.save();
        }
    });

    log.info(`初始化：正在创建插件热加载监听`);
    chokidar.watch(`${global._path}/src/`,).on("change", async (filepath, stats) => {
        if (!devEnv && !hotLoadStatus) return;
        if (require.cache[filepath]) {
            log.mark(`文件 ${filepath} 正在进行热更新`);
            delete require.cache[filepath];
            if (!devEnv) return client.directMessageApi.postDirectMessage((await redis.hGet(`directUid->Gid`, adminId[0]))!, {
                content: `文件 ${filepath} 正在进行热更新`,
                msg_id: await redis.get("lastestMsgId") || undefined,
            });
        }
    });

    log.info(`初始化：正在创建指令文件热加载监听`);
    chokidar.watch(`${global._path}/config/opts.json`).on("change", async (filepath, stats) => {
        if (!devEnv && !hotLoadStatus) return;
        if (require.cache[filepath]) {
            log.mark(`指令配置文件正在进行热更新`);
            delete require.cache[filepath];
            if (!devEnv) return client.directMessageApi.postDirectMessage((await redis.hGet(`directUid->Gid`, adminId[0]))!, {
                content: `指令配置文件正在进行热更新`,
                msg_id: await redis.get("lastestMsgId") || undefined,
            });
        }
    });

    log.info(`初始化：正在连接数据库`);
    global.redis = createClient({
        socket: { host: "127.0.0.1", port: 6379, },
        database: 0,
    });
    await global.redis.connect().then(() => {
        log.info(`初始化：redis 数据库连接成功`);
    }).catch(err => {
        log.error(`初始化：redis 数据库连接失败，正在退出程序\n${err}`);
        process.exit();
    });

    global.mariadb = await createPool(config.mariadb).getConnection().then(conn => {
        log.info(`初始化：mariadb 数据库连接成功`);
        return conn;
    });

    log.info(`初始化：正在创建 client 与 ws`);
    global.client = createOpenAPI(config.initConfig);
    global.ws = createWebsocket(config.initConfig);

    log.info(`初始化：正在创建频道树`);
    await loadGuildTree(true);

    global.client.meApi.me().then(res => global.meId = res.data.id);

    await reloadStudentInfo("local").then(d => {
        log.info(`学生数据加载完毕 ${d}`);
    });
}

export async function loadGuildTree(init?: boolean) {
    if (!global.saveGuildsTree) global.saveGuildsTree = {};

    const guildData = await client.meApi.meGuilds().catch(err => log.error(err));
    if (!guildData) return;
    for (const guild of guildData.data) {
        if (init) log.mark(`${guild.name}(${guild.id})`);
        if (!saveGuildsTree[guild.id]) saveGuildsTree[guild.id] = { ...guild, channel: {} };
        else saveGuildsTree[guild.id].name = guild.name;

        const channelData = await client.channelApi.channels(guild.id).catch(err => log.error(err));
        if (!channelData) return;
        for (const channel of channelData.data) {
            if (init) log.mark(`${guild.name}(${guild.id})-${channel.name}(${channel.id})-father:${channel.parent_id}`);
            saveGuildsTree[guild.id].channel[channel.id] = { name: channel.name, id: channel.id };
        }
    }
}

Date.prototype.toDBString = function () {
    return [
        this.getFullYear(),
        (this.getMonth() + 1).toString().padStart(2, "0"),
        this.getDate().toString().padStart(2, "0"),
    ].join("-") + "T" +
        [
            this.getHours().toString().padStart(2, "0"),
            this.getMinutes().toString().padStart(2, "0"),
            this.getSeconds().toString().padStart(2, "0"),
        ].join(":") + "+08:00";
}