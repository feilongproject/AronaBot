import fs from 'fs';
import OpenAI from 'openai';
import COS from 'cos-nodejs-sdk-v5';
import { PoolConfig } from 'mariadb';
import { AvailableIntentsEventsEnum } from 'qq-bot-sdk';

global._path = process.cwd();
const workspace = process.env.WORKSPACE || '/root/RemoteDir/qbot/AronaBot';
const workspaceData = `${workspace}/data`;

export default {
    bots: {
        AronaBot: {
            appID: 'YOUR_APP_ID',
            token: 'YOUR_TOKEN',
            secret: 'YOUR_SECRET',
            dsKey: ``,
            intents: [
                AvailableIntentsEventsEnum.GUILD_MESSAGES,
                AvailableIntentsEventsEnum.DIRECT_MESSAGE,
                AvailableIntentsEventsEnum.GUILDS,
                AvailableIntentsEventsEnum.FORUMS_EVENT,
                AvailableIntentsEventsEnum.GUILD_MEMBERS,
                AvailableIntentsEventsEnum.GUILD_MESSAGE_REACTIONS,
                AvailableIntentsEventsEnum.MESSAGE_AUDIT,
                AvailableIntentsEventsEnum.GROUP_AND_C2C_EVENT,
                AvailableIntentsEventsEnum.INTERACTION,
                AvailableIntentsEventsEnum.MESSAGE_AUDIT,
            ],
            allowMarkdown: true,
            allowMariadb: true,
            webhookPort: {
                prod: 2340,
                dev: 2341,
            },
            groupMap: {} as Record<string, string>,
            meRealId: 'YOUR_REAL_ID',
            enableFullReceiveGroups: [],
        },
        TestBot: {
            appID: 'YOUR_TEST_APP_ID',
            token: 'YOUR_TEST_TOKEN',
            dsKey: ``,
            intents: [AvailableIntentsEventsEnum.GUILD_MESSAGES],
            allowMarkdown: false,
            allowMariadb: false,
            webhookPort: {
                prod: 0,
                dev: 0,
            },
            groupMap: {} as Record<string, string>,
            meRealId: '',
            enableFullReceiveGroups: [] as string[],
        },
    },
    hotLoadConfigs: [
        {
            path: `${global._path}/src/eventRec.ts`,
            type: '消息接收处理模块',
        },
        {
            path: `${global._path}/src/plugins/`,
            type: '插件模块',
        },
        {
            path: `${global._path}/config/opts.ts`,
            type: '指令模块',
        },
        {
            path: `${global._path}/data/handbookMatches.ts`,
            type: '攻略匹配模块',
        },
        {
            path: `${global._path}/data/keyboardMap.ts`,
            type: '按钮布局',
        },
    ],
    hotLoadConfigsReload: [
        {
            path: `${global._path}/src/plugins/schedule.ts`,
            name: '定时任务',
        },
    ],
    initConfig: {},
    baiduCensoring: {
        APP_ID: 'YOUR_BAIDU_APP_ID',
        API_KEY: 'YOUR_BAIDU_API_KEY',
        SECRET_KEY: 'YOUR_BAIDU_SECRET_KEY',
    },
    mariadb: {
        host: '127.0.0.1',
        port: 13306,
        user: 'root',
        password: 'YOUR_DB_PASSWORD',
        connectTimeout: 5000,
        connectionLimit: 100,
    } as PoolConfig,
    redis: {
        socket: { host: '127.0.0.1', port: 6379 },
        password: 'YOUR_REDIS_PASSWORD',
        database: 0,
    },
    cos: {
        SecretId: 'YOUR_COS_SECRET_ID',
        SecretKey: 'YOUR_COS_SECRET_KEY',
        Bucket: 'YOUR_COS_BUCKET',
        Region: 'ap-guangzhou',
    } as COS.COSOptions & Omit<COS.ObjectParams, 'Key'>,
    groupPush: {
        url: 'http://127.0.0.1:15500/v1/chronocat.putongdejiekou1',
        authKey: 'YOUR_AUTH_KEY',
        appId: 'YOUR_EVENT_APP_ID',
        llobKey: 'YOUR_LLOB_KEY',
    },
    onebot: {
        baseUrl: 'http://127.0.0.1:13000',
        localUploadPath: '/opt/llob/LiteLoader/upload',
        remoteUploadPath: '/opt/QQ/resources/app/LiteLoader/upload',
    },
    sms: {
        AccessKey: {
            AccessKeyId: 'YOUR_SMS_ACCESS_KEY',
            AccessKeySecret: 'YOUR_SMS_ACCESS_SECRET',
        },
        sendInfo: {
            phone: 12345678901,
            sign: 'YOUR_SMS_SIGN',
            template: 'SMS_TEMPLATE',
        },
    },
    cosUrl: 'https://oss-your-domain.com',
    retryTime: 5,
    studentNameDict: `${workspaceData}/jiebaDict.txt`,
    errorMessageTemaple: `${workspaceData}/errorMessageTemaple.html`,
    studentInfo: `${workspaceData}/studentInfo.json`,
    gachaPoolInfo: `${workspaceData}/gachaPoolInfo.json`,
    aliasStudentNameLocal: `${workspaceData}/aliasStudentNameLocal.json`,
    studentNameAlias: `${workspaceData}/studentNameAlias.json`,
    imagesOut: '/tmp/randPic',
    handbookRoot: `${workspaceData}/images/handbook`,
    extractRoot: `${workspaceData}/extract`,
    images: {
        gachaMask: [
            '',
            `${workspaceData}/images/gacha/Card_Item_Bg_R.png`,
            `${workspaceData}/images/gacha/Card_Item_Bg_SR.png`,
            `${workspaceData}/images/gacha/Card_Item_Bg_SSR.png`,
        ],
        characters: `${workspaceData}/images/characterPortraits`,
        accuseCharacters: `${workspaceData}/accuseCharacters`,
        firstChecker: `${workspaceData}/images/firstChecker`,
        starBg: `${workspaceData}/images/gacha/starBg.png`,
        star: `${workspaceData}/images/gacha/star.png`,
        mainBg: `${workspaceData}/images/gacha/mainBg.png`,
        cutAris: `${workspaceData}/images/cutAris`,
        sponsor: `${workspaceData}/images/afdian.png`,
        Tarot: `${workspaceData}/images/Tarot`,
        baLogo: `${workspaceData}/images/baLogo`,
    },
    fontRoot: `${workspaceData}/fonts`,
    aiTranslate: {
        apiKey: `YOUR_OPENAI_API_KEY`,
        createParams: {
            model: 'qwen3-max-preview',
            max_tokens: 1000,
            temperature: 0,
            stream: false,
            messages: [
                {
                    role: 'system',
                    content: 'SYSTEM_PROMPT',
                },
                {
                    role: 'user',
                    content: '8月14日(水)4:00〜8月18日(日)3:59',
                },
                {
                    role: 'assistant',
                    content: '北京时间8月14日(星期三)3:00〜8月18日(星期日)2:59',
                },
            ],
        } as OpenAI.ChatCompletionCreateParamsNonStreaming,
    },
    _picPath: {
        font: `${workspaceData}/pic/NotoSansTC-Medium.otf`,
        avatarBg: `${workspaceData}/pic/rand/avatarBg.png`,
    },
};
