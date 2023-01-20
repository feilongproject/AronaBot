import fs from 'fs';
import fetch from 'node-fetch';
import config from '../../config/config.json';


const nameToId = { jp: 0, global: 1 };
var key: keyof typeof nameToId;

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

export async function pushToDB(table: string, data: { [key: string]: string }) {
    if (devEnv) return;

    const keys: string[] = [];
    const keyss: string[] = [];
    const values: string[] = [];
    for (const k in data) {
        keys.push(k);
        keyss.push("?");
        values.push(data[k]);
    }
    //log.debug(`INSERT INTO ${table} (${keys.join()}) VALUES (${keyss.join()})`);
    return mariadb.query(`INSERT INTO ${table} (${keys.join()}) VALUES (${keyss.join()})`, values).catch(err => {
        log.error(err);
    });
}

export async function reloadStudentInfo(type: "net" | "local"): Promise<"net ok" | "local ok" | "ok"> {

    const _studentInfo: StudentInfo = {};
    if (type == "net") {
        const netStudents: StudentInfoNet[] = await fetch("https://ghproxy.com/https://raw.githubusercontent.com/lonqie/SchaleDB/main/data/cn/students.json").then(res => {
            return res.json();
        }).catch(err => log.error(err));
        if (!netStudents) throw `can't fetch json:students`;

        const aliasStudentName: { [name: string]: string[] } = await fetch("https://ghproxy.com/https://raw.githubusercontent.com/lgc2333/bawiki-data/main/data/stu_alias.json").then(res => {
            return res.json();
        }).catch(err => log.error(err));
        if (!aliasStudentName) throw `can't fetch json:aliasStudentName`;

        for (const d of netStudents) {
            const devName = d.DevName[0].toLocaleUpperCase() + d.DevName.slice(1);
            if (!aliasStudentName[d.Name]) throw `not found aliasStudentName: ${d.Name}`;
            _studentInfo[d.Id] = { releaseStatus: d.IsReleased, name: [d.Name, ...aliasStudentName[d.Name]], pathName: d.PathName, devName, star: d.StarGrade };
            if (d.IsLimited) continue;
            if (!fs.existsSync(`${config.picPath.characters}/Student_Portrait_${devName}.png`))
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

export async function settingUserConfig(aid: string, types: "GET", data: string[]): Promise<{ [key: string]: string; }>
export async function settingUserConfig(aid: string, types: "SET", data: { [key: string]: string; }): Promise<{ [key: string]: string; }>
export async function settingUserConfig(aid: string, types: "GET" | "SET", data: string[] | { [key: string]: string; }): Promise<{ [key: string]: string; }> {
    if (types == "GET" || Array.isArray(data))
        return redis.hmGet(`setting:${aid}`, data as string[]).then(hmData => {
            const _ret: { [key: string]: string; } = {};
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


interface StudentInfoNet {
    Id: number;
    Name: string;
    DevName: string;
    PathName: string;
    StarGrade: 1 | 2 | 3;
    IsLimited: number;
    IsReleased: [boolean, boolean];
}
