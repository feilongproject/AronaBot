import fs from 'fs';
import fetch from 'node-fetch';
import config from '../../config/config';
import { IMessageDIRECT } from './IMessageEx';


const nameToId = { jp: 0, global: 1 };
var key: keyof typeof nameToId;

export async function sendToAdmin(content: string) {
    return new IMessageDIRECT({
        id: await redis.get(`lastestMsgId`) || "08f3fb8adca9d6ccf46710b4e66c38cba64e48a2cfa1a006",
    } as any, false).sendToAdmin(content);
}

export async function sleep(ms: number) {
    return new Promise(resovle => { setTimeout(resovle, ms) });
}

export async function callWithRetry<T extends (...args: A) => Promise<R>, R, A extends Array<any>>(functionCall: (...args: A) => Promise<R>, args: Parameters<T>, retries = 0, errors: any[] = []): Promise<RetryResult<R>> {
    try {
        const result = await functionCall(...args);
        return { result, errors };
    } catch (err) {
        if (err && ((err as any).code == 304027) && args && args[0] && args[0].msgId) { //message is expired
            retries--;
            args[0].msgId = await redis.get(`lastestMsgId`);
        } else log.error(err);
        if (typeof err == "object") errors.push(JSON.stringify(err));
        else errors.push(String(err));
        if (err && (err as any).code == 304003 || ((err as any)?.msg as string | null)?.includes("url not allowed")) {
            log.error(`url 不被允许:\n`, JSON.stringify(args[0]));
            throw { errors: errors };
        }
        if (err && (err as any).code == 40014 || ((err as any)?.msg as string | null)?.includes("file too large")) {
            log.error(`文件过大\n`, JSON.stringify(args[0]));
            throw { errors: errors };
        }
        if (retries < config.retryTime - 1) {
            await sleep(300);
            return await callWithRetry(functionCall, args, ++retries, errors);
        } else {
            if (args && args[0] && args[0].imageFile) args[0].imageFile = { type: "Buffer", length: args[0].imageFile.length };
            log.error(`重试多次未成功 args:\n`, JSON.stringify(args[0]));
            throw { errors: errors };
        }
    }
}

export function writeFileSyncEx(filePath: string, data: string | Buffer, options?: fs.WriteFileOptions) {

    const pathPart = filePath.split("/");
    pathPart.pop();

    if (fs.existsSync(pathPart.join("/"))) {
        fs.writeFileSync(filePath, data, options);

    } else {
        var _p = "";
        for (const [iv, _part] of pathPart.entries()) {
            //if (iv + 1 == pathPart.length) break;
            _p += `${_part}/`;
            if (fs.existsSync(_p)) continue;
            else fs.mkdirSync(_p);
        }
        writeFileSyncEx(filePath, data, options);
    }
}

export async function pushToDB(table: string, data: Record<string, any>) {
    if (devEnv) return;

    const keys: string[] = [];
    const keyss: string[] = [];
    const values: string[] = [];
    for (const k in data) {
        keys.push(k);
        keyss.push("?");
        values.push(typeof data[k] == "object" ? JSON.stringify(data[k]) : `${data[k]}`);
    }
    //log.debug(`INSERT INTO ${table} (${keys.join()}) VALUES (${keyss.join()})`);
    return mariadb.query(`INSERT INTO ${table} (${keys.join()}) VALUES (${keyss.join()})`, values).catch(err => {
        log.error(err);
    });
}

export async function searchDB(table: string, key: string, value: string) {
    return mariadb.query(`SELECT * FROM ${table} WHERE ${key} = ?`, value).catch(err => {
        log.error(err);
    });
}

export async function reloadStudentInfo(type: "net" | "local"): Promise<"net ok" | "local ok" | "ok"> {

    const _studentInfo: StudentInfos = {};
    if (type == "net") {
        const netStudents: StudentInfoNet[] | void = await fetch("https://raw.gh.schale.top/lonqie/SchaleDB/main/data/cn/students.min.json", {
            timeout: 10 * 1000,
        }).then(res => res.json()).then((json: StudentInfoNet[]) => json.map(v => ({ ...v, Name: fixName(v.Name) }))).catch(err => log.error(err));
        if (!netStudents) throw `can't fetch json:students`;

        const aliasStudentNameLocal: Record<string, string[]> = JSON.parse(fs.readFileSync(config.aliasStudentNameLocal, { encoding: "utf8" }));
        const aliasStudentNameWeb: Record<string, string[]> | void = await fetch("https://raw.gh.schale.top/lgc2333/bawiki-data/main/data/stu_alias.json", {
            timeout: 10 * 1000,
        }).then(res => res.json()).then((json: Record<string, string[]>) => {
            for (const names in json) json[names] = json[names].map(v => fixName(v));
            return json;
        }).catch(err => log.error(err));
        if (!aliasStudentNameWeb) throw `can't fetch json:aliasStudentNameWeb`;

        for (const d of netStudents) {
            const devName = d.DevName[0].toUpperCase() + d.DevName.slice(1);
            _studentInfo[d.Id] = {
                id: d.Id,
                releaseStatus: d.IsReleased,
                name: [d.Name, String(d.Id), fixName(d.DevName), fixName(d.PathName)],
                devName,
                pathName: d.PathName,
                star: d.StarGrade,
                limitedType: d.IsLimited,
            };

            const asnw = aliasStudentNameWeb[d.Name];
            if (asnw) for (const _nameWeb of asnw)
                if (!_nameWeb.includes("老婆")) _studentInfo[d.Id].name.push(_nameWeb); // 去除私货
            for (const _ of _studentInfo[d.Id].name)
                if (aliasStudentNameLocal[_]) _studentInfo[d.Id].name.push(...aliasStudentNameLocal[_]); // 增加本地别名

            _studentInfo[d.Id].name = _studentInfo[d.Id].name.filter((v, i, arr) => arr.indexOf(v, 0) === i); // 去重

            if (!fs.existsSync(`${config.images.characters}/Student_Portrait_${devName}.png`))
                throw `not found png file in local: Student_Portrait_${devName}`;
        }
        global.studentInfo = _studentInfo;
        fs.writeFileSync(config.studentInfo, JSON.stringify(_studentInfo));
        return "net ok";
    } else if (type == "local") {
        if (fs.existsSync(config.studentInfo)) {
            global.studentInfo = JSON.parse(fs.readFileSync(config.studentInfo).toString());
            return "local ok";
        } else return reloadStudentInfo("net");
    }
    return "ok";
}

export async function settingUserConfig(aid: string, types: "GET", data: string[]): Promise<Record<string, string>>
export async function settingUserConfig(aid: string, types: "SET", data: Record<string, string>): Promise<Record<string, string>>
export async function settingUserConfig(aid: string, types: "GET" | "SET", data: string[] | Record<string, string>): Promise<Record<string, string>> {
    if (types == "GET" || Array.isArray(data))
        return redis.hmGet(`setting:${aid}`, data as string[]).then(hmData => {
            const _ret: Record<string, string> = {};
            for (const [index, _hmData] of hmData.entries()) _ret[(data as string[])[index]] = _hmData;
            return _ret;
        });

    const kv: [string, string][] = [];
    for (const key in data)
        if (data[key]) kv.push([key, data[key]]);
    return redis.hSet(`setting:${aid}`, kv).then(() => {
        return data;
    });
}

export function findStudentInfo(name: string) {
    for (const id in studentInfo) if (studentInfo[id].name.includes(fixName(name))) return studentInfo[id];
    return null;
}

export async function findDirectAidToGid(aid: string, guildId: string): Promise<string> {

    const redisGid = await redis.hGet(`directUid->Gid`, aid).catch(err => log.error(err));
    if (redisGid) return redisGid;


    const createGid = await client.directMessageApi.createDirectMessage({
        source_guild_id: guildId,
        recipient_id: aid,
    }).then(res => {
        return res.data.guild_id;
    }).catch(err => {
        log.error(err);
    });
    if (createGid) {
        await redis.hSet(`directUid->Gid`, aid, createGid);
        return createGid;
    }
    throw "not found guild and create guild";
}

const fixName = (name: string) => name.replace("（", "(").replace("）", ")").toLowerCase();

export function timeConver(ms: number) {
    ms = Number((ms / 1000).toFixed(0));

    if (ms == 0) return "0分钟";
    if (ms < 60) return "不足1分钟";

    const s = ms % 60;
    ms = (ms - s) / 60;

    const m = ms % 60;
    ms = (ms - m) / 60;

    const h = ms % 24;
    ms = (ms - h) / 24;

    return `${ms ? `${ms}天 ` : ``}${h ? `${h}小时 ` : ``}${m ? `${m}分钟 ` : ``}`;
}

export interface StudentInfoNet {
    Id: number;
    Name: string;
    DevName: string;
    PathName: string;
    StarGrade: 1 | 2 | 3;
    IsLimited: number;
    IsReleased: [boolean, boolean];
}
