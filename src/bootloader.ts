import COS from 'cos-nodejs-sdk-v5';
import { encode, decode } from 'js-base64';
import { mkdirSync, existsSync } from 'fs';
import logger from './libs/logger';
import { StudentInfo, StudentNameAlias } from './libs/globalVar';
import config from '../config/config';

export function initRuntime() {
    global.log = logger;
    log.log(`机器人准备运行，正在初始化`);

    if (!existsSync(config.imagesOut)) mkdirSync(config.imagesOut);

    global.adminId = [
        '2975E2CA5AE779F1899A0AED2D4FA9FD',
        '1728904631', // PlanaBot+大号
        '7681074728704576201',
        '15874984758683127001', // 频道？
        '21EE2355F1D4106219EC134842203DF6',
        'D8893EE07438D29FC12B776139EBEC6D',
    ];
    global.botStatus = {
        startTime: new Date(),
        msgSendNum: 0,
        imageRenderNum: 0,
    };
    global.mdParamLength = 120;
    global.hotLoadStatus = 0;

    global.devEnv = process.argv.includes('--dev');
    if (devEnv) {
        log.mark('当前环境处于开发环境，请注意！');
        setTimeout(
            () => {
                process.exit();
            },
            1000 * 60 * 60,
        );
    }

    const currentBotType = Object.keys(config.bots).find((v) => process.argv.includes(v)) as
        | BotTypes
        | undefined;
    if (!currentBotType) throw new Error('未知配置! 请选择正确的botType');
    global.botType = currentBotType;
    global.allowMarkdown = config.bots[global.botType].allowMarkdown;
    global.meAppId = config.bots[global.botType].appID;
    log.info(`初始化: botType: ${botType}, allowMarkdown: ${allowMarkdown}, meAppId: ${meAppId}`);

    log.info(`初始化: 正在连接腾讯 COS`);
    global.cos = new COS(config.cos);
}

Date.prototype.toDBString = function () {
    return (
        [
            this.getFullYear(),
            (this.getMonth() + 1).toString().padStart(2, '0'),
            this.getDate().toString().padStart(2, '0'),
        ].join('-') +
        'T' +
        [
            this.getHours().toString().padStart(2, '0'),
            this.getMinutes().toString().padStart(2, '0'),
            this.getSeconds().toString().padStart(2, '0'),
        ].join(':') +
        '+08:00'
    );
};

Buffer.prototype.json = function () {
    return JSON.parse(this.toString());
};

global.strFormat = function (obj: any) {
    return [JSON.stringify(obj, undefined, ' '.repeat(4)), String(obj)].reduce((a, b) =>
        a.length > b.length ? a : b,
    );
};

global.sleep = function (ms: number) {
    return new Promise((resovle) => {
        setTimeout(resovle, ms);
    });
};

global.fixName = function (name: string): string {
    name = name
        .replace('（', '(')
        .replace('）', ')')
        .toLowerCase()
        .replaceAll(' ', '')
        .replace(/(国际?服|日服|​「|」|\+| |\.|。)/g, '');
    if (name.includes('(') && !name.includes(')')) name += ')';
    return name;
};

global.cosPutObject = async (params) => cos.putObject({ ...config.cos, ...params });

// global.cosUrl = (key: string) => `https://${config.cos.Bucket}.cos.${config.cos.Region}.myqcloud.com/${key}`;
// global.cosUrl = (key: string) => `https://${config.cos.Bucket}.cos-website.${config.cos.Region}.myqcloud.com/${key}`;
global.cosUrl = (key: string, fix = '!Image3500K') => {
    key = `${key}${fix || ''}`;
    const authKey = new COS(config.cos).getAuth({ Key: key, Expires: 60 * 5 });
    return `${config.cosUrl}/${key}?${authKey}`;
};
global.isNumStr = (value: string): value is `${number}` => /^\d+$/.test(value);
(global as any).btoa = encode;
(global as any).atob = decode;
global.studentNameAlias = new StudentNameAlias();
global.studentInfo = new StudentInfo();
