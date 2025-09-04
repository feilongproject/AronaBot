import chokidar from "chokidar";
import COS from "cos-nodejs-sdk-v5";
import schedule from "node-schedule";
import { createPool } from 'mariadb';
import { createClient } from 'redis';
import { encode, decode } from "js-base64";
import { mkdirSync, existsSync } from "fs";
import { IChannel, IGuild, createOpenAPI, createWebsocket } from "qq-bot-sdk";
import { sendToAdmin } from './libs/common';
import { StudentInfo, StudentNameAlias } from "./libs/globalVar";
import config from '../config/config';


export async function init() {

    console.log(`机器人准备运行，正在初始化`);
    if (!existsSync(config.imagesOut)) mkdirSync(config.imagesOut);

    global.adminId = ["7681074728704576201", "15874984758683127001", "2975E2CA5AE779F1899A0AED2D4FA9FD",
        "21EE2355F1D4106219EC134842203DF6",
        "D8893EE07438D29FC12B776139EBEC6D"];
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
    global.meAppId = config.bots[botType].appID;
    log.info(`初始化: botType: ${botType}, allowMarkdown: ${allowMarkdown}, meAppId: ${meAppId}`);

    log.info(`初始化: 正在加载命令设置`);
    global.commandConfig = (await import("../config/opts")).default;

    log.info(`初始化: 正在创建模块热加载监听`);
    for (const hotloadConfig of config.hotLoadConfigs) {
        log.info(`初始化: 正在创建模块热加载监听: ${hotloadConfig.type}`);
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

    log.info(`初始化: 正在创建全局变量热加载监听`);
    const hotloadJson: { p: string, classVar: InstanceWithReload }[] = [];
    hotloadJson.push({ p: config.studentInfo, classVar: studentInfo });
    hotloadJson.push({ p: config.studentNameAlias, classVar: studentNameAlias });
    for (const { p, classVar } of hotloadJson) {
        const constructorName = Object.getPrototypeOf(classVar).constructor.name;
        log.info(`初始化: 正在创建全局变量热加载监听: ${constructorName}`);
        chokidar.watch(p).on("change", async (filepath, stats) => {
            log.mark(`${constructorName} 正在进行热更新`);
            classVar.reload();
        });
    }

    log.info(`初始化: 正在连接腾讯 COS`);
    global.cos = new COS(config.cos);

    log.info(`初始化: 正在连接 redis 数据库`);
    const connectRedis = async (init = true, retry = 0) => {
        global.redis = createClient(config.redis);
        await global.redis.connect().then(() => redis.ping()).then(pong => {
            log.info((init ? "初始化: " : "重连: ") + `redis 数据库连接成功 ${pong}`);
        }).catch(err => {
            log.error((init ? "初始化: " : "重连: ") + `redis 数据库连接失败， retry: ${retry}\n`, err);
            if (retry > 5) process.exit();
            else return connectRedis(false, ++retry) as any;
        });

        redis.on("error", err => {
            log.error(err);
        })
    };
    await connectRedis();

    log.info(`初始化: 正在连接 mariadb 数据库`);
    const connectMariadb = async (init = true, retry = 0) => {
        global.mariadb = await createPool({
            ...config.mariadb,
            database: botType,
        }).getConnection().catch(err => {
            log.error((init ? "初始化: " : "重连: ") + `mariadb 数据库连接失败, retry: ${retry}\n`, err);
            if (retry > 5) process.exit();
            else return connectMariadb(false, ++retry) as any;
        });
        mariadb?.on("error", (err) => {
            log.error("mariadb.error", err);
            mariadb.end();
            mariadb.release();
            connectMariadb(false);
        });
        log.info(`${init ? "初始化: " : "重连: "}mariadb 数据库连接成功`);
    };
    if (config.bots[botType].allowMariadb) await connectMariadb();

    // setInterval(async () => {
    //     const _ = await mariadb.query("SHOW DATABASES;").catch(err => {
    //         // if(err instanceof SqlError)mariadb.isValid
    //         log.error(err);
    //     });;
    //     log.debug(_);
    // }, 1000 * 5);

    // mariadb.on("end", () => {
    //     log.error("mariadb end");
    //     process.exit();
    // });
    // setTimeout(async () => {
    //     await mariadb.end();
    //     await mariadb.destroy();
    // }, 5 * 1000);
    // setTimeout(() => {
    //     mariadb.query(`SELECT * FROM biliMessage WHERE userId = ?`, "297972654").then(data => {
    //         log.debug(data);
    //     }).catch(err => {
    //         log.error(err);
    //     });
    // }, 10 * 1000);

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
        schedule.scheduleJob("*/10 * * * * ? ", () => redis.setEx("devEnv", 10, botType));
    } else if (botType == "AronaBot") {
        schedule.scheduleJob("0 * * * * ? ", () => redis.save().then(v => log.mark(`保存数据库:${v}`)));
        schedule.scheduleJob("0 */3 * * * ?", () => import("./plugins/admin").then(module => module.updateEventId()));
        schedule.scheduleJob("0 */10 * * * ? ", () => import("./plugins/biliDynamic").then(module => module.mainCheck()).catch(err => {
            log.error(err);
            return sendToAdmin((typeof err == "object" ? strFormat(err) : String(err)).replaceAll(".", ",")).catch(() => { });
        }));
    } else if (botType === 'PlanaBot') {
        schedule.scheduleJob("0 */3 * * * ?", () => import("./plugins/interaction").then(module => module.callButton()));
    }

    if (await redis.exists(`isRestart:${meId}`)) {
        await redis.del(`isRestart:${meId}`);
        return sendToAdmin(`${botType} 重启成功`).catch(() => { });
    } else if (!devEnv) return sendToAdmin(`${botType} 启动成功`).catch(() => { });
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
Buffer.prototype.json = function () {
    return JSON.parse(this.toString());
}

global.strFormat = (obj: any) => [JSON.stringify(obj, undefined, " ".repeat(4)), String(obj)].reduce((a, b) => a.length > b.length ? a : b);;
global.sleep = (ms: number) => new Promise(resovle => { setTimeout(resovle, ms) });
global.fixName = (name: string): string => {
    name = name.replace("（", "(").replace("）", ")").toLowerCase().replaceAll(" ", "").replace(/(国际?服|日服|​「|」|\+| |\.|。)/g, "");
    if (name.includes("(") && !name.includes(")")) name += ")";
    return name;
};
global.cosPutObject = async (params) => cos.putObject({ ...config.cos, ...params, });
// global.cosUrl = (key: string) => `https://${config.cos.Bucket}.cos.${config.cos.Region}.myqcloud.com/${key}`;
// global.cosUrl = (key: string) => `https://${config.cos.Bucket}.cos-website.${config.cos.Region}.myqcloud.com/${key}`;
global.cosUrl = (key: string, fix = "!Image3500K") => {
    key = `${key}${fix || ""}`;
    const authKey = new COS(config.cos).getAuth({ Key: key, Expires: 60 * 5 });
    return `${config.cosUrl}/${key}?${authKey}`;
};
global.isNumStr = (value: string): value is `${number}` => /^\d+$/.test(value);
(global as any).btoa = encode;
(global as any).atob = decode;
global.studentNameAlias = new StudentNameAlias();
global.studentInfo = new StudentInfo();
