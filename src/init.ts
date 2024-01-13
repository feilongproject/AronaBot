import chokidar from "chokidar";
import { createPool } from 'mariadb';
import { createClient } from 'redis';
import schedule from "node-schedule";
import { IChannel, IGuild, createOpenAPI, createWebsocket } from "qq-bot-sdk";
import _log from './libs/logger';
import { reloadStudentInfo, sendToAdmin } from './libs/common';
import config from '../config/config';

export async function init() {

    console.log(`机器人准备运行，正在初始化`);

    global.adminId = ["7681074728704576201", "15874984758683127001", "2975E2CA5AE779F1899A0AED2D4FA9FD"];
    global.log = _log;
    global._path = process.cwd();
    global.botStatus = {
        startTime: new Date(),
        msgSendNum: 0,
        imageRenderNum: 0,
    }
    global.hotLoadStatus = 0;

    if (process.argv.includes("--dev")) {
        global.devEnv = true;
        log.mark("当前环境处于开发环境，请注意！");
    } else global.devEnv = false;

    global.botType = Object.keys(config.bots).find(v => process.argv.includes(v)) as BotTypes;
    if (!botType) {
        log.error(`未知配置! 请选择正确的botType`);
        process.exit();
    }
    global.allowMarkdown = config.bots[botType].allowMarkdown;

    log.info(`初始化: 正在创建插件热加载监听`);
    chokidar.watch(`${global._path}/src/`,).on("change", async (filepath, stats) => {
        if (filepath.endsWith("src/init.ts") || filepath.endsWith("src/index.ts")) return;
        if (!devEnv && !hotLoadStatus) return;
        if (require.cache[filepath]) {
            hotLoadStatus--;
            log.mark(`文件 ${filepath} 正在进行热更新`);
            delete require.cache[filepath];
            if (!devEnv) return sendToAdmin(`文件 ${filepath} 正在进行热更新 ${hotLoadStatus}`);
        }
    });

    log.info(`初始化: 正在创建指令文件热加载监听`);
    chokidar.watch(`${global._path}/config/opts.json`).on("change", async (filepath, stats) => {
        if (!devEnv && !hotLoadStatus) return;
        if (require.cache[filepath]) {
            hotLoadStatus--;
            log.mark(`指令配置文件正在进行热更新`);
            delete require.cache[filepath];
            if (!devEnv) return sendToAdmin(`指令配置文件正在进行热更新 ${hotLoadStatus}`);
        }
    });

    log.info(`初始化: 正在连接数据库`);
    global.redis = createClient({
        socket: { host: "127.0.0.1", port: 6379, },
        database: 0,
    });
    await global.redis.connect().then(() => {
        log.info(`初始化: redis 数据库连接成功`);
    }).catch(err => {
        log.error(`初始化: redis 数据库连接失败，正在退出程序\n${err}`);
        process.exit();
    });

    global.mariadb = await createPool({
        ...config.mariadb,
        database: botType,
    }).getConnection().then(conn => {
        log.info(`初始化: mariadb 数据库连接成功`);
        return conn;
    }).catch(err => {
        log.error(`初始化: mariadb 数据库连接失败，正在退出程序\n${err}`);
        process.exit();
    });

    log.info(`初始化: 正在创建 client 与 ws`);
    global.client = createOpenAPI(config.bots[botType]);
    global.ws = createWebsocket(config.bots[botType]);
    global.ws.once("READY", async (data: IntentMessage.READY) => {
        log.mark(`ws已建立, 机器人信息: ${data.msg.user.username}(${data.msg.user.id})`);
    });

    log.info(`初始化: 正在创建频道树`);
    await loadGuildTree(true);

    await global.client.meApi.me().then(res => global.meId = res.data.id);

    await reloadStudentInfo("local").then(d => {
        log.info(`学生数据加载完毕 ${d}`);
    });

    log.info(`初始化: 正在创建定时任务`);
    if (devEnv) {
        await redis.setEx("devEnv", 10, "1");
        schedule.scheduleJob("*/10 * * * * ? ", () => redis.setEx("devEnv", 10, "1"));
        // schedule.scheduleJob("0 */5 * * * ?", () => import("./plugins/pusher").then(module => module.updateGithubVersion()));
        // schedule.scheduleJob("0 */3 * * * ?", () => import("./plugins/admin").then(module => module.updateEventId()));
    } else if (botType == "AronaBot") {
        schedule.scheduleJob("0 * * * * ? ", () => redis.save().then(v => log.mark(`保存数据库:${v}`)));
        schedule.scheduleJob("0 */3 * * * ?", () => import("./plugins/admin").then(module => module.updateEventId()));
        schedule.scheduleJob("0 */5 * * * ?", () => import("./plugins/pusher").then(module => module.updateGithubVersion()));
        schedule.scheduleJob("0 */5 * * * ? ", () => import("./plugins/biliDynamic").then(module => module.mainCheck()).catch(err => {
            log.error(err);
            return sendToAdmin((typeof err == "object" ? JSON.stringify(err) : String(err)).replaceAll(".", ",")).catch(() => { });
        }));
    }

}

export async function loadGuildTree(init?: boolean): Promise<any>;
export async function loadGuildTree(init: IChannel | IGuild): Promise<any>;
export async function loadGuildTree(init?: boolean | IChannel | IGuild): Promise<any> {
    if (!global.saveGuildsTree) global.saveGuildsTree = {};

    if (typeof init == "object") {
        // TODO: 当首次加入时, 不存在 saveGuildsTree[init.id] 需要单独获取
        if ("member_count" in init) {
            if (global.saveGuildsTree[init.id]) return saveGuildsTree[init.id] = { ...init, channels: saveGuildsTree[init.id].channels };
            const guildInfo = await getGuildInfo(init);
            if (!guildInfo) return log.error(`频道 ${init.name}(${init.id}) 信息获取失败`);
            return saveGuildsTree[init.id] = guildInfo;
        }
        if (("position" in init) && saveGuildsTree[init.guild_id]) saveGuildsTree[init.guild_id].channels[init.id] = init;
        return;
    };

    const guildData = await client.meApi.meGuilds().then(res => res.data).catch(err => log.error(err));
    if (!guildData) return;
    for (const guild of guildData) {
        if (init === true) log.mark(`${guild.name}(${guild.id})`);
        const guildInfo = await getGuildInfo(guild);
        if (!guildInfo) continue;
        global.saveGuildsTree[guild.id] = guildInfo;
    }
}

async function getGuildInfo(gInfo: IGuild): Promise<SaveGuild> {
    const guildInfo: SaveGuild = { ...gInfo, channels: {} };
    const channelData = await client.channelApi.channels(gInfo.id).then(res => res.data).catch(err => log.error(err));
    if (!channelData) return guildInfo;
    for (const channel of channelData) {
        // if (init) log.mark(`${guild.name}(${guild.id})-${channel.name}(${channel.id})-father:${channel.parent_id}`);
        guildInfo.channels[channel.id] = { ...channel };
    }
    return guildInfo;
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
};

global.stringifyFormat = function (obj: Object) {
    return JSON.stringify(obj, undefined, "    ");
};

(global as any).btoa = null;
(global as any).atob = null;