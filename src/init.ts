import chokidar from "chokidar";
import COS from "cos-nodejs-sdk-v5";
import { createPool } from 'mariadb';
import { createClient } from 'redis';
import schedule from "node-schedule";
import { IChannel, IGuild, createOpenAPI, createWebsocket } from "qq-bot-sdk";
import { sendToAdmin } from './libs/common';
import config from '../config/config';


export async function init() {

    console.log(`机器人准备运行，正在初始化`);

    global.adminId = ["7681074728704576201", "15874984758683127001", "2975E2CA5AE779F1899A0AED2D4FA9FD", "21EE2355F1D4106219EC134842203DF6"];
    global.botStatus = {
        startTime: new Date(),
        msgSendNum: 0,
        imageRenderNum: 0,
    }
    global.mdParamLength = 120;
    global.hotLoadStatus = 0;

    global.devEnv = process.argv.includes("--dev");
    global.log = (await import("./libs/logger")).default;
    if (devEnv) {
        log.mark("当前环境处于开发环境，请注意！");
        setTimeout(() => {
            process.exit();
        }, 1000 * 60 * 60);
    }

    global.botType = Object.keys(config.bots).find(v => process.argv.includes(v)) as BotTypes;
    if (!botType) {
        log.error(`未知配置! 请选择正确的botType`);
        process.exit();
    }
    global.allowMarkdown = config.bots[botType].allowMarkdown;

    log.info(`初始化: 正在创建热加载监听`);
    for (const hotloadConfig of config.hotLoadConfigs) {
        log.info(`初始化: 正在创建热加载监听: ${hotloadConfig.type}`);
        chokidar.watch(hotloadConfig.path).on("change", async (filepath, stats) => {
            if (!devEnv && !hotLoadStatus) return;
            if (require.cache[filepath]) {
                hotLoadStatus--;
                const fileD = filepath.replace(_path, "").split(".")[0];
                log.mark(`${hotloadConfig.type} ${fileD} 正在进行热更新`);
                delete require.cache[filepath];
                if (!devEnv) return sendToAdmin(`${devEnv} ${hotloadConfig.type} ${fileD} 正在进行热更新 ${hotLoadStatus}`);
            }
        });
    }

    log.info(`初始化: 正在连接数据库`);
    global.redis = createClient(config.redis);
    await global.redis.connect().then(() => redis.ping()).then(pong => {
        log.info(`初始化: redis 数据库连接成功 ${pong}`);
    }).catch(err => {
        log.error(`初始化: redis 数据库连接失败，正在退出程序\n${err}`);
        process.exit();
    });

    log.info(`初始化: 正在连接腾讯 COS`);
    global.cos = new COS(config.cos);

    if (config.bots[botType].allowMariadb) global.mariadb = await createPool({
        ...config.mariadb,
        database: botType,
    }).getConnection().catch(err => {
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

    await import("./plugins/studentInfo").then(module => module.reloadStudentInfo("local")).then(d => {
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


    if (await redis.exists(`isRestart:${meId}`)) {
        await redis.del(`isRestart:${meId}`);
        return sendToAdmin("重启成功");
    }

}

export async function loadGuildTree(init?: boolean): Promise<any>;
export async function loadGuildTree(init: IChannel | IGuild): Promise<any>;
export async function loadGuildTree(init?: boolean | IChannel | IGuild): Promise<any> {
    if (!global.saveGuildsTree) global.saveGuildsTree = {};

    if (typeof init == "object") {
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

global.stringifyFormat = (obj: any) => JSON.stringify(obj, undefined, "    ");
global.sleep = (ms: number) => new Promise(resovle => { setTimeout(resovle, ms) });
global.fixName = (name: string) => name.replace("（", "(").replace("）", ")").toLowerCase().replaceAll(" ", "").replace(/(国际?服|日服)/g, "");
global.cosPutObject = async (params: CosPutObjectParams) => cos.putObject({ ...config.cos, ...params, });
// global.cosUrl = (key: string) => `https://${config.cos.Bucket}.cos.${config.cos.Region}.myqcloud.com/${key}`;
// global.cosUrl = (key: string) => `https://${config.cos.Bucket}.cos-website.${config.cos.Region}.myqcloud.com/${key}`;
global.cosUrl = (key: string, fix = "!Image3500K") => `${config.cosUrl}/${key}${fix || ""}`;
(global as any).btoa = null;
(global as any).atob = null;
