global.adminId = [];

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import COS from 'cos-nodejs-sdk-v5';
import { createClient } from 'redis';
import { exec, execSync } from 'child_process';
import config from '../config/config';
import { handbookMatches, studentEvaluation, getLastestImage } from '../src/plugins/handbook';
import { findStudentInfo } from '../src/plugins/studentInfo';

// const rl = readline.createInterface({
//     input: process.stdin,
//     output: process.stdout,
// });

global.redis = createClient(config.redis);
const window = { __INITIAL_STATE__: {} as any };
const document = { currentScript: { parentNode: { removeChild: () => {} } } };
global.studentInfo = JSON.parse(fs.readFileSync(config.studentInfo).toString());
global.strFormat = (obj: any) => JSON.stringify(obj, undefined, '    ');
global.sleep = (ms: number) =>
    new Promise((resovle) => {
        setTimeout(resovle, ms);
    });
global.fixName = (name: string) =>
    name
        .toLowerCase()
        .replace('（', '(')
        .replace('）', ')')
        .replaceAll(' ', '')
        .replace(/(国际?服|日服)/g, '');
global.cosPutObject = async (params: CosPutObjectParams) =>
    cos.putObject({ ...config.cos, ...params });
global.cosUrl = (key: string, fix = '!Image3500K') => `${config.cosUrl}/${key}${fix || ''}`;
const wget = (url: string) => fetch(url).then((res) => res.buffer());

console.log(`初始化: 正在连接腾讯 COS`);
global.cos = new COS(config.cos);
const checked: string[] = [];

async function check(postUrl: string) {
    const _html = await (await fetch(postUrl)).text();
    const match = /<script>(window\.__INITIAL_STATE__=(.*?);)<\/script>/.exec(_html);
    if (!match) return;
    eval(match[1]);
    const html = window.__INITIAL_STATE__.readInfo.content;

    const $ = cheerio.load(html);

    const childrenNode: any[] = [...$('body').children()]
        .map((v) => {
            const _text = $(v).text();
            if (_text) return _text;

            if (v.tagName != 'figure') return;

            return $(v).html();

            debugger;
        })
        .map((v) => {
            if (!v) return;

            //50: '空崎 阳奈(ヒナ/Hina_Dress).礼服 向阳绽放 少女们的小夜曲三周年活动FES池限定'
            // '尾刃 环奈(Kanna/カンナ_Swimsuit)).泳装 泳七「Say-Bing!」活动追加常驻'
            // "砂狼 白子＊恐怖(シロコ＊テラー/Shiroko＊Terror)  3.5周年主线剧情FES角UP"
            v = v
                .replace('Kanna/カンナ', 'カンナ/Kanna')
                .replace('みさき/Misaki', 'みさき/shokuhou_misaki')
                .replaceAll('＊', '_');
            const match = /\(.+\/(?<enName>\w+)\)/.exec(v);
            const enName = match?.groups?.enName;

            const img = cheerio.load(v)('img');

            const width = img.attr('width');
            const height = img.attr('height');
            const imgUrl = img.attr('data-src')?.replace('https://', '//');

            return enName || (width && height ? imgUrl : undefined);
        })
        .filter((v) => typeof v === 'string');

    const imgList: { url: string; name: string; desc?: string }[] = [];
    for (const [i, _] of childrenNode.entries()) {
        if (_.startsWith('//') || !childrenNode[i + 1]?.startsWith('//')) continue;

        imgList.push({ url: 'https:' + childrenNode[i + 1], name: _ });
    }

    for (const [i, student] of imgList.entries()) {
        const searchInfo = findStudentInfo(student.name);
        if (!searchInfo) {
            debugger;
            process.exit();
        }
        console.log(
            `get! ${searchInfo.devName} ${searchInfo.name[0]} === ${student.name} ${student.url}`,
        );
        checked.push(searchInfo.devName);
        imgList[i].name = searchInfo.devName;
        imgList[i].desc = searchInfo.name[0];
        // debugger;
    }
    console.log('\n');

    fs.readdirSync('/tmp')
        .filter((v) => v.startsWith('hbupdate-'))
        .map((v) => fs.rmSync(`/tmp/${v}`, { recursive: true, force: true }));
    const localRoot = fs.mkdtempSync('/tmp/hbupdate-');
    fs.mkdirSync(localRoot + '/cgi-bin/');
    const finishList = [];
    for (const img of imgList) {
        const picName = `${img.name}.png`;
        const imageKey = `studentEvaluation/${picName}`;
        const buffRemote = await wget(img.url);
        const buffLocal = fs.existsSync(`${config.handbookRoot}/${imageKey}`)
            ? fs.readFileSync(`${config.handbookRoot}/${imageKey}`)
            : undefined;

        if (
            buffLocal &&
            buffLocal.length == buffRemote.length &&
            Buffer.compare(buffRemote, buffLocal) == 0
        ) {
            try {
                const has = await cos.headObject({ ...config.cos, Key: `handbook/${imageKey}` });
                if (
                    has.statusCode == 200 &&
                    Number((has.headers || {})['content-length']) == buffRemote.length
                ) {
                    console.log(`cos与远端存在相同: ${img.desc}  --->  ${img.name}`);
                    continue;
                } else {
                    process.stdout.write(`cos存储桶未更新 ${img.desc}  --->  ${img.name} `);
                }
            } catch (err: any) {
                if (err.statusCode == 404 || err.code == '404') {
                    process.stdout.write(`cos存储桶未找到 ${img.desc}  --->  ${img.name} `);
                } else debugger;
            }
        } else {
            process.stdout.write(`本地不匹配 ${img.desc}  --->  ${img.name} `);
        }

        fs.writeFileSync(`${localRoot}/${picName}`, buffRemote);
        fs.writeFileSync(`${localRoot}/old_${picName}`, buffLocal || Buffer.from([]));
        console.log(`  wget: ${localRoot}/${img.name}.png`);

        finishList.push({ ...img, buff: buffRemote, picName, imageKey });

        // debugger;
    }
    if (!finishList.length) return console.log(`已全部更新完毕`);

    const checkId = new Date().getTime();
    const cgi = `
#!/usr/bin/env python3
import cgi
import cgitb
from pathlib import Path

cgitb.enable()
checked = cgi.FieldStorage().getvalue("checked", "")
local_dir = "${localRoot}"
print("Content-Type: text/html;charset=utf-8")
print()

if checked == "${checkId}":
    print("<h1>ojbk</h1>")
    open(Path(local_dir)/"checked", "wb").write(b"checked")
else:
    print("<h1>:(</h1>")
    `.trim();
    const showHtml = `
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
</head>
<body style="display: flex;flex-wrap: wrap;">
    ${finishList.map(
        (v) =>
            `<div style="width: 30rem;display: flex;flex-direction: column; margin-bottom: 50px;">` +
            `    <span style="font-size: 1.5rem;">${v.desc} == ${v.name}</span>` +
            `    <div>` +
            `       <img src="${v.picName}" style="width: 25rem;"/>` +
            `       <img src="old_${v.picName}" style="width: 25rem;"/>` +
            `    </div>` +
            `</div>`,
    )}
    <form action="cgi-bin/check.py">
        <input type="text" name="checked" value="" />
        <input type="submit" value="Submit" />
    </form>
    ${checkId}
</body>
`;

    fs.writeFileSync(`${localRoot}/index.html`, showHtml);
    fs.writeFileSync(`${localRoot}/cgi-bin/check.py`, cgi, { mode: 0o755 });
    execSync(`chown nobody:nogroup -R ${localRoot}`);

    console.log(`\nchecking! ${localRoot}/index.html ${localRoot}/cgi-bin/check.py`);
    const p = exec(`/bin/python3 -m http.server --cgi 5173 --directory ${localRoot}`);

    while (!fs.existsSync(localRoot + '/checked')) {
        console.log('please review change...', new Date());
        await sleep(5000);
    }
    const pids = execSync('lsof -i:5173')
        .toString()
        .split('\n')
        .filter((v) => v.startsWith('python'))
        .map((v) => v.split(/\s+/)[1]);
    console.log(
        `kill ${pids}`,
        pids.map((pid) => execSync(`kill ${pid}`).toString()),
    );

    console.log(`\nstart save local`);
    for (const img of finishList) {
        const localPath = `${config.handbookRoot}/${img.imageKey}`;
        console.log(`save ${img.name}(${img.desc}) to ${localPath}`);

        const imageName = `studentEvaluation`;
        const { name: imageType, buff: imageBuff } = img;
        await redis.hSet('handbook:cache', `${imageName}:${imageType}`, new Date().getTime());
        // await redis.hSet("handbook:info", `${imageName}:${imageType}`, imageDesc || "");
        // await redis.hSet("handbook:infoUrl", `${imageName}:${imageType}`, imageTurnUrl || "");
        await cosPutObject({ Key: `handbook/${img.imageKey}`, Body: imageBuff });
        fs.writeFileSync(localPath, imageBuff);

        const lastestImage = await getLastestImage(imageName, imageType);
    }

    console.log('\n\n\n\n');
    // debugger;
}

(async () => {
    await global.redis
        .connect()
        .then(() => {
            console.log(`初始化: redis 数据库连接成功`);
        })
        .catch((err) => {
            console.error(`初始化: redis 数据库连接失败，正在退出程序\n${err}`);
            process.exit();
        });

    /**

all: https://www.bilibili.com/read/cv37205003

格黑娜篇: https://www.bilibili.com/read/cv20550762
圣三一篇: https://www.bilibili.com/read/cv20557188
千年篇: https://www.bilibili.com/read/cv20560474
阿比多斯百鬼篇: https://www.bilibili.com/read/cv20550621
SRT山海阿里乌斯红冬篇: https://www.bilibili.com/read/cv20550020
*/
    await check('https://www.bilibili.com/read/cv20550762/');
    await check('https://www.bilibili.com/read/cv20557188/');
    await check('https://www.bilibili.com/read/cv20560474/');
    await check('https://www.bilibili.com/read/cv20550621/');
    await check('https://www.bilibili.com/read/cv20550020/');

    const noCheck = Object.values(studentInfo).filter((v) => !checked.includes(v.devName));
    console.log(
        `本次未检查到: ${noCheck.map((v) => `${v.name[0]}(${v.devName})`).join('  :::  ')}`,
    );

    debugger;
    process.exit();
})();
