import fs from 'fs';
import { createClient } from 'redis';
import schedule from "node-schedule";
import { createOpenAPI, createWebsocket, OpenAPI } from 'qq-guild-bot';
import _log from './libs/logger';
import config from '../config/config.json';

export async function init() {

    console.log(`机器人准备运行，正在初始化`);

    global.adminId = config.admin.uid;
    global._path = process.cwd();
    global.log = _log;
    global.botStatus = {
        startTime: new Date(),
        msgSendNum: 0,
        imageRenderNum: 0,
    }

    //log.info(`初始化：正在创建定时任务`);
    //schedule.scheduleJob("0 * * * * ? ", async () => (await import("./plugins/biliDynamic")).taskPushBili());

    log.info(`初始化：正在创建插件热加载监听`);
    fs.watch(`${global._path}/src/plugins/`, (event, filename) => {
        //log.debug(event, filename);
        if (event != "change") return;
        log.mark(`文件${global._path}/src/plugins/${filename}正在进行热更新`);
        if (require.cache[`${global._path}/src/plugins/${filename}`]) {
            delete require.cache[`${global._path}/src/plugins/${filename}`];
        }
    });

    log.info(`初始化：正在创建指令文件热加载监听`);
    const optFile = `${global._path}/config/opts.json`;
    fs.watchFile(optFile, () => {
        log.mark(`指令配置文件正在进行热更新`);
        if (require.cache[optFile]) {
            delete require.cache[optFile];
        }
    });

    log.info(`初始化：正在连接数据库`);
    global.redis = createClient({
        socket: { host: "127.0.0.1", port: 6379, },
        database: 0,
    });
    await global.redis.connect().then(() => {
        log.info(`初始化：redis数据库连接成功`);
    }).catch(err => {
        log.error(`初始化：redis数据库连接失败，正在退出程序\n${err}`);
        process.exit();
    });

    log.info(`初始化：正在创建client与ws`);
    global.client = createOpenAPI(config.initConfig);
    global.ws = createWebsocket(config.initConfig as any);

    log.info(`初始化：正在创建频道树`);
    global.saveGuildsTree = [];
    for (const guild of (await global.client.meApi.meGuilds()).data) {
        log.mark(`${guild.name}(${guild.id})`);
        var _guild: SaveChannel[] = [];
        for (const channel of (await global.client.channelApi.channels(guild.id)).data) {
            if (channel.name != "") {
                log.mark(`${guild.name}(${guild.id})-${channel.name}(${channel.id})-father:${channel.parent_id}`);
            }
            _guild.push({ name: channel.name, id: channel.id });
        }
        global.saveGuildsTree.push({ name: guild.name, id: guild.id, channel: _guild });
    }

    global.client.meApi.me().then(res => {
        global.meId = res.data.id;
    });
    /*
    return new Databaser({
        host: "127.0.0.1",
        port: 13306,
        user: "root",
        password: "P@ssWord14789",
        database: "AronaBot",
        connectTimeout: 5,
    }, config.initConfig); */
}
