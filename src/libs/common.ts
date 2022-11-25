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