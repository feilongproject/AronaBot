import fs from 'fs';

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