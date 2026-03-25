global.adminId = [];

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import format from 'date-format';
import * as cheerio from 'cheerio';
import { createClient } from 'redis';
import { execSync } from 'child_process';
import config from '../config/config';
import { studentEvaluation } from '../src/plugins/handbook';
import { findStudentInfo } from '../src/plugins/studentInfo';

global.redis = createClient(config.redis);
global.studentInfo = JSON.parse(fs.readFileSync(config.studentInfo).toString());
global.strFormat = (obj: any) => JSON.stringify(obj, undefined, '    ');
global.sleep = (ms: number) =>
    new Promise((resovle) => {
        setTimeout(resovle, ms);
    });
global.fixName = (name: string) =>
    name
        .replace('（', '(')
        .replace('）', ')')
        .toLowerCase()
        .replaceAll(' ', '')
        .replace(/(国际?服|日服)/g, '');
global.cosPutObject = async (params: CosPutObjectParams) =>
    cos.putObject({ ...config.cos, ...params });
global.cosUrl = (key: string, fix = '!Image3500K') => `${config.cosUrl}/${key}${fix || ''}`;

const png = (n: string) => `${n}.png`;

(async () => {
    const rootPath = config.handbookRoot + '/studentEvaluation/';
    const localNames = fs.readdirSync(rootPath).map((v) => v.replace(/\.png$/, ''));

    for (const localName of localNames) {
        const findStudent = findStudentInfo(localName);
        console.log(
            `检查中: ${findStudent?.name[0]}  :::::  ${localName} ----> ${findStudent?.devName}`,
        );
        if (localName == 'all') continue;
        if (findStudent) {
            if (findStudent.devName == localName) continue;
            fs.renameSync(rootPath + png(localName), rootPath + png(findStudent.devName));
            console.log(`${png(localName)} ---> ${png(findStudent.devName)}`);
            continue;
        }

        debugger;
    }

    console.log('\n\n\n');

    for (const id in studentInfo) {
        if (!isNumStr(id)) continue;
        const student = studentInfo[id];
        if (fs.existsSync(rootPath + png(student.devName))) continue;

        console.log(`本地未找到: ${student?.devName} ----> ${student?.name[0]}`);
    }
})();
