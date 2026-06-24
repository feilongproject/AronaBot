import fs from 'fs';
import axios from 'axios';
import format from 'date-format';
import * as cheerio from 'cheerio';
import imageSize from 'image-size';
import { mailerError } from '../libs/mailer';
import { sendToAdmin, settingUserConfig } from '../libs/common';
import { IMessageC2C, IMessageDIRECT, IMessageGROUP, IMessageGUILD } from '../libs/IMessageEx';
import config from '../../config/config';
import { BiliDynamic } from '../types/Dynamic';

const noSetServerMessage = `\n(未指定/未设置服务器, 默认使用国际服)`;
const getErrorMessage = `发送时出现了一些问题<@${adminId[0]}>\n这可能是因为腾讯获取图片出错导致, 请稍后重试\n`;
const needUpdateMessage = `若数据未更新，请直接@bot管理, 或使用「查询攻略」功能`;
const updateTimeMessage = `图片更新时间：`;

const serverMap: Record<string, string> = { jp: '日服', global: '国际服', cn: '国服', all: '' };
const provideMap: Record<string, string> = {
    jp: '夜猫',
    global: '夜猫',
    cn: '朝夕desu',
    all: '夜猫',
};
const fuzzyLimit = 6;

export const handbookMatches: HandbookMatches.Root = {
    names: {
        totalAssault: {
            reg: /^\/?总力战一图流/,
            typeReg: /(总力战?(一图流?)?)|(totalAssault)/,
            desc: '总力战一图流',
            has: [HandbookMatches.Type.JP, HandbookMatches.Type.GLOBAL],
        },
        clairvoyance: {
            reg: /^\/?(千|万)里眼|qly/,
            typeReg: /(千里眼?)|(clairvoyance)/,
            desc: '千里眼',
            has: [HandbookMatches.Type.GLOBAL, HandbookMatches.Type.CN],
        },
        activityStrategy: {
            reg: /^\/?活动攻略/,
            typeReg: /(活动(攻略)?)|(activity(Strategy)?)/,
            desc: '活动攻略',
            has: [HandbookMatches.Type.JP, HandbookMatches.Type.GLOBAL],
        },
        studentEvaluation: {
            reg: /^\/?(角评|角色评价)/,
            typeReg: /(角评|角色评价)|student(Evaluation)?/,
            desc: '角评',
            has: [HandbookMatches.Type.ALL],
        },
        //MultiFloorRaid
    },
    types: {
        global: /(国际|g(lobal)?)服?/,
        jp: /(日|jp?)服?/,
        cn: /(国|cn?)服?/,
    },
};

export async function handbookMain(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
) {
    const forceGuildType =
        'guild_id' in msg && ['16392937652181489481'].includes(msg.guild_id)
            ? HandbookMatches.Type.CN
            : undefined;
    const hbMatched = await matchHandbook(msg, forceGuildType).catch((err) => strFormat(err));
    if (typeof hbMatched == 'string')
        return msg.sendMsgEx({ content: `未找到对应攻略数据，${hbMatched}` });
    const lastestImage = hbMatched.fuzzy
        ? undefined
        : await getLastestImage(hbMatched.name, hbMatched.type);
    const filePath = `${config.handbookRoot}/${hbMatched.name}/${hbMatched.type}.png`;
    if (devEnv) log.debug(msg.content, hbMatched, lastestImage);

    const at_user =
        (msg instanceof IMessageGROUP ? `` : `<@${msg.author.id}> `) +
        `\u200b \u200b == ${serverMap[hbMatched.type] ?? hbMatched.nameDesc ?? hbMatched.type}` +
        `${hbMatched.desc} == ${hbMatched.default ? noSetServerMessage : ''}`;
    const handbookAuthor =
        provideMap[hbMatched.type] || hbMatched.name == 'studentEvaluation'
            ? provideMap.jp
            : undefined;

    return msg
        .sendMarkdown({
            content:
                at_user +
                (hbMatched.fuzzy ? '' : `\n${needUpdateMessage}\n攻略制作: ${handbookAuthor}\n`) +
                // + (lastestImage?.info ? `${lastestImage.info}\n` : ""), // sb腾讯，'type:business, code:30, msg:["[[图片] [少女]]","[[少女] [图片]]"]'
                `![img #${lastestImage?.width || -1}px #${lastestImage?.height || 1}px](${lastestImage?.url || '  '})` +
                `\n${lastestImage?.updateTime || (hbMatched.fuzzy ? '当前为模糊搜索，请从以下搜素结果中选择(若点击无效果请更新QQ至新版):\n' : '')}` +
                (lastestImage?.infoUrl ? `[🔗详情点我](${lastestImage.infoUrl})` : '') +
                (hbMatched.fuzzy || [])
                    .map((fuzzy) => mdCmdLink(`「${fuzzy.name}」`, `角评 ${fuzzy.name}`))
                    .flat()
                    .slice(0, -1),

            keyboardNameId: 'handbook',
            // markdown 部分
        })
        .catch(async (err) => {
            mailerError({ hbMatched, lastestImage, msg }, err);
        });
}

function mdCmdLink(showDesc: string, command: string, enter = true) {
    command = command.replace(/\(/g, '（').replace(/\)/g, '）');
    return [
        `[${showDesc}]`,
        `(mqqapi://aio/inlinecmd?command=${encodeURI(command)}&reply=false&enter=${enter})`,
        '\r',
    ];
}

async function matchHandbook(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
    forceType?: HandbookMatches.Type,
): Promise<HandbookMatched | string> {
    const content = msg.content.replaceAll(/<@!?[A-Z0-9]+>/g, '').trim();
    const [hbMatchedType, hbMatchedName] =
        Object.entries(handbookMatches.names).find(([k, v]) => v.reg.test(content)) || [];
    if (!hbMatchedType || !hbMatchedName) return '未匹配到攻略类型';

    const hbType: HandbookMatches.Type | undefined =
        forceType ||
        (hbMatchedName.has.includes(HandbookMatches.Type.ALL) // 角评只有all
            ? HandbookMatches.Type.ALL
            : ((Object.entries(handbookMatches.types).find(([_, v]) => v.test(content)) ||
                  [])[0] as any));
    const ret: HandbookMatched & typeof hbMatchedName = {
        name: hbMatchedType,
        type: hbType!,
        ...hbMatchedName,
        default: true,
    };
    if (hbMatchedType == 'studentEvaluation') {
        const _ = await studentEvaluation(content);
        ret.type = _.type; // fuzzy或者角色的devName
        ret.nameDesc = _.desc || ret.nameDesc; // 对于type的描述, 精准匹配时为角色名称
        ret.fuzzy = _.fuzzy; // 模糊匹配结果
    } else {
        if (ret.type && !ret.has.includes(ret.type))
            return `暂未支持「${ret.type}」类型${ret.desc}`;
        const customType = (await settingUserConfig(msg.author.id, 'GET', ['server']))
            .server as HandbookMatches.Type;
        if (forceType) {
            ret.default = false;
            ret.type = forceType;
        } else if (customType) {
            ret.default = false;
            ret.type = ret.has.includes(customType) ? customType : HandbookMatches.Type.GLOBAL;
        } else {
            ret.type = hbType || HandbookMatches.Type.GLOBAL;
        }
    }
    return ret;
}

export async function getLastestImage(name: string, type = 'all'): Promise<HandbookInfo.Data> {
    const updateTime = await redis.hGet('handbook:cache', `${name}:${type}`);
    const imageInfo = await redis.hGet('handbook:info', `${name}:${type}`);
    const infoUrl = await redis.hGet('handbook:infoUrl', `${name}:${type}`);
    const size = imageSize(fs.readFileSync(`${config.handbookRoot}/${name}/${type}.png`));
    return {
        height: size.height || 400,
        width: size.width || 400,
        info: imageInfo || '',
        infoUrl: infoUrl || '',
        updateTime:
            updateTimeMessage +
            (updateTime ? format.asString(new Date(Number(updateTime) || updateTime)) : '未知'),
        url: cosUrl(`handbook/${name}/${type}.png`),
    };
}

export async function handbookUpdate(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
) {
    if (!adminId.includes(msg.author.id)) return;
    const matched =
        /hbupdate(?<imageId>\d+)?\s+(?<name>\S+)\s+(?<type>\S+)\s+(?<url>(https?:\/\/)?\S+)\s?(?<desc>.+)?/.exec(
            msg.content,
        );
    // log.debug(matched?.groups);
    if (!matched || !matched.groups)
        return msg.sendMsgExRef({
            content: `命令错误，命令格式：` + `/hbupdate[imageId] (name) (type) (url) [desc]`,
        });

    const { imageId, name, type, url, desc } = matched.groups;

    // 图片 name 开始
    var imageName = '';
    const matchNames = handbookMatches.names;
    for (const _key in matchNames) {
        if (RegExp(matchNames[_key].typeReg).test(name)) {
            imageName = _key;
            break;
        }
    }
    if (!imageName) return msg.sendMsgEx({ content: `${name} 未找到` });
    // 图片 name 结束

    // 图片 type 开始
    var imageType = type;
    if (imageName == 'studentEvaluation') {
        try {
            imageType = (await studentEvaluation(type)).type;
        } catch (err) {
            log.error(err);
            return msg.sendMsgEx({
                content: `判断图片type时出现错误\n` + JSON.stringify(err).replaceAll('.', ','),
            });
        }
    } else if (!Object.hasOwnProperty.call(serverMap, type))
        return msg.sendMsgEx({
            content: `未找到类型 ${type} ，允许类型： ${Object.keys(serverMap)}`,
        });
    else if (!matchNames[imageName] || !matchNames[imageName]?.has?.includes(type as any))
        return msg.sendMsgEx({
            content: `${imageName} 中未找到类型 ${type} ，仅支持 ${matchNames[imageName].has}`,
        });
    // 图片 type 结束

    // 图片 desc turnUrl 开始
    var imageDesc = '';
    var imageTurnUrl = '';
    if (/(arona\.schale\.top\/turn)|(t\.bilibili\.com\/(\d+))/.test(desc)) {
        try {
            const descUrl = /((https?:\/\/)?\S+)\s*/.exec(desc)![1];
            await axios(descUrl.startsWith('https://') ? descUrl : 'https://' + descUrl)
                .then((res) => {
                    const redirectUrl = res.request._redirectable._currentUrl;
                    const matchDynamicId = (/https:\/\/t.bilibili.com\/(\d+)/.exec(redirectUrl) ||
                        [])[1];
                    if (matchDynamicId)
                        return import('./biliDynamic').then((module) =>
                            module.getDynamicInfo(matchDynamicId),
                        );
                    else throw `未知的url: ${redirectUrl}`;
                })
                .then((data: BiliDynamic.InfoRoot) => {
                    if (
                        data.data.item.modules.module_dynamic.major.type ==
                        BiliDynamic.MajorTypeEnum.MAJOR_TYPE_ARTICLE
                    ) {
                        const article = data.data.item.modules.module_dynamic.major.article!;
                        const cvId = /cv(\d+)/.exec(article.jump_url)![1];
                        imageTurnUrl = `https://bilibili.com/read/cv${cvId}`;
                        imageDesc = article.title
                            .replaceAll(/((蔚|碧)蓝档案)/g, '')
                            .replace(/^\//, '')
                            .trim();
                    } else
                        throw `未知的动态类型: ${data.data.item.modules.module_dynamic.major.type}`;
                });
        } catch (err) {
            log.error(err);
            return msg.sendMsgEx({
                content: `解析desc时出现错误\n` + JSON.stringify(err).replaceAll('.', ','),
            });
        }
    } else if (/cv(\d+)/.test(desc)) {
        imageTurnUrl = `https://bilibili.com/read/cv${/cv(\d+)/.exec(desc)![1]}`;
    } else imageDesc = desc || '';
    // 图片 desc turnUrl 结束

    // 图片 URL 开始
    var imageUrl = /(?<imageUrl>(https:\/\/)?.+hdslb\.com\/.+\.(png|jpg|jpeg))/.exec(url)?.groups
        ?.imageUrl;
    if (!imageUrl && /(arona\.schale\.top\/turn)|(t\.bilibili\.com\/(\d+))/.test(url)) {
        try {
            imageUrl = await axios(url.startsWith('https://') ? url : 'https://' + url)
                .then((res) => {
                    const redirectUrl = res.request._redirectable._currentUrl;
                    // log.debug(res.url);
                    const matchDynamicId = (/https:\/\/t.bilibili.com\/(\d+)/.exec(redirectUrl) ||
                        [])[1];
                    if (matchDynamicId)
                        return import('./biliDynamic').then((module) =>
                            module.getDynamicInfo(matchDynamicId),
                        );
                    else throw `未知的url: ${redirectUrl}`;
                })
                .then((data: BiliDynamic.InfoRoot) => {
                    const draw = data.data.item.modules.module_dynamic.major.draw;
                    // log.debug(draw);
                    if (!draw) throw `未找到指定动态中的图片`;
                    if (Number(imageId) <= 0 || Number(imageId) > draw.items.length)
                        throw `查询图片 id:${imageId} 超出范围，范围: 1 - ${draw.items.length}`;
                    return draw.items[Number(imageId) - 1 || 0].src;
                });
        } catch (err) {
            log.error(err);
            return msg.sendMsgEx({
                content: `查找图片时出现错误\n` + JSON.stringify(err).replaceAll('.', ','),
            });
        }
    }
    if (!imageUrl) return msg.sendMsgExRef({ content: '图片未找到' });
    // 图片 URL 结束

    // 发送总结信息
    await msg.sendMsgEx({
        content: (
            `已判断完毕，正在下载` +
            `\nname: ${imageName}` +
            `\ntype: ${imageType}` +
            `\ndesc: ${imageDesc || ''}` +
            `\nimageTurnUrl: ${imageTurnUrl}`
        ).replaceAll('.', ','),
    });
    const imageKey = `${imageName}/${imageType}.png`;

    await redis.hSet('handbook:cache', `${imageName}:${imageType}`, new Date().getTime());
    await redis.hSet('handbook:info', `${imageName}:${imageType}`, imageDesc || '');
    await redis.hSet('handbook:infoUrl', `${imageName}:${imageType}`, imageTurnUrl || '');
    const imageBuff = await axios({
        url: imageUrl.startsWith('http') ? imageUrl : `https://${imageUrl}`,
        responseType: 'arraybuffer',
    }).then((res) => res.data);
    fs.writeFileSync(`${config.handbookRoot}/${imageKey}`, imageBuff);
    cosPutObject({ Key: `handbook/${imageKey}`, Body: imageBuff });

    const lastestImage = await getLastestImage(imageName, imageType);
    if (devEnv) log.debug(lastestImage);
    await axios({
        url: lastestImage.url,
        headers: { 'user-agent': 'QQShareProxy' },
        timeout: 60 * 1000,
        responseType: 'arraybuffer',
    })
        .then((res) => res.data)
        .then((buff) =>
            msg.sendMsgEx({
                content: `${imageName} ${imageType} ${(imageDesc || '').replaceAll('.', ',')}\nsize: ${(buff.length / 1024).toFixed(2)}K`,
            }),
        )
        .catch((err) => log.error(err));

    return msg.sendMsgEx({
        content: `图片已缓存`,
        imageUrl: lastestImage.url, //imageUrl + "@1048w_!web-dynamic.jpg",
    });
}

export async function activityStrategyPush(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
) {
    if (!adminId.includes(msg.author.id)) return;
    const reg = /攻略(发布|更新)\s*(cv(\d+))?\s*(\d+)?/.exec(msg.content)!;
    const cv = Number(reg[3]);
    const channelId = reg[4];

    if (!cv || !channelId)
        return msg.sendMsgEx({
            content: `无法解析cv或channelId` + `\ncv: ${cv}` + `\nchannelId: ${channelId}`,
        });

    const encode = cv.toString(2).replaceAll('0', '\u200c').replaceAll('1', '\u200d');
    const isHas = await axios({
        url: `https://api.sgroup.qq.com/channels/${channelId}/threads`,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`,
        },
    })
        .then((res) => res.data)
        .then((json) =>
            (json.threads as any[]).find((thread) =>
                (thread.thread_info.title as string).startsWith(encode),
            ),
        )
        .catch((err) => log.error(err));
    if (isHas) return msg.sendMsgEx({ content: `已查询到存在相同动态` });

    return axios({
        url: `https://www.bilibili.com/read/cv${cv}`,
        headers: {
            'user-agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36 Edg/112.0.1722.58',
        },
    })
        .then((res) => res.data)
        .then((html) => {
            const $ = cheerio.load(html);
            return eval(
                'const window={};' +
                    $('script')
                        .filter(function (i, el) {
                            return $(this).text().startsWith('window.__INITIAL_STATE__');
                        })
                        .text()
                        .replace(/\(function\(\){.*}\(\)\)/, ''),
            );
        })
        .then(async (data) => {
            const content =
                `<h1>该贴由BA彩奈bot自动爬取b站专栏并发送</h1>` +
                `<h1>作者: ${data.readInfo.author.name}</h1>`;
            // + `<h1>来源: <a href="https://www.bilibili.com/read/cv${cv}">https://www.bilibili.com/read/cv${cv}</a></h1>`
            // + `<h1>\u200b</h1>`
            // + (data.readInfo.content as string).replaceAll(`<img data-src="`, `<img src="`);
            const title: string = data.readInfo.title;
            return { title, content };
        })
        .then((postInfo) =>
            axios({
                url: `https://api.sgroup.qq.com/channels/${channelId}/threads`,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bot ${config.bots[botType].appID}.${config.bots[botType].token}`,
                },
                data: JSON.stringify({
                    title: postInfo.title,
                    content: postInfo.content,
                    format: 2,
                }),
            }),
        )
        .then((res) => res.data)
        .then((text) => msg.sendMsgEx({ content: `已发布\n${text}` }))
        .catch((err) => msg.sendMsgEx({ content: `获取出错\n${err}` }));
}

export async function searchHandbook(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
) {
    const matched = /\/?.*((查询|搜索)攻略|攻略(查询|搜索))\s*(?<searchKey>.+)$/.exec(
        msg.content,
    )?.groups;
    const { searchKey } = matched || {};
    if (!(searchKey || '').trim())
        return msg.sendMsgExRef({
            content: `请输入要查询的攻略！例：` + `\n/查询攻略 1-1`,
        });
    const resultData: DiyigemtAPI.Root = await axios(
        `https://arona.diyigemt.com/api/v1/image?name=${searchKey}`,
    ).then((res) => res.data);
    if (!resultData.data)
        return msg.sendMsgEx({ content: `未搜索到相关攻略，请更换关键词重新搜索喵` });

    const imageUrl = `https://arona.cdn.diyigemt.com/image${resultData.data[0].path}?hash=${resultData.data[0].hash}`;
    if (resultData.data.length == 1)
        return msg.sendMarkdown({
            content:
                `<@${msg.author.id}>\n` +
                `数据来源: diyigemt\n` +
                `![img #1920px #1080px](${imageUrl})`,
            keyboardNameId: 'handbook',
        });
    else if (resultData.data.length > 1)
        return msg.sendMsgEx({
            content:
                `${msg instanceof IMessageGROUP ? `` : `<@${msg.author.id}>`} 模糊查询结果如下：\n` +
                resultData.data.map((v, i) => `第${i + 1} 搜索结果: ${v.name}`).join('\n'),
        });
}

export async function studentEvaluation(
    content: string,
): Promise<{ type: HandbookMatches.Type; desc: string; fuzzy?: SearchPinyin[] }> {
    const studentName = fixName(
        content.replace(handbookMatches.names.studentEvaluation.reg, '').trim(),
    );
    if (!studentName || studentName == 'all') return { type: HandbookMatches.Type.ALL, desc: '' };
    const findedInfo = await import('./studentInfo').then((module) =>
        module.findStudentInfo(studentName),
    );
    if (findedInfo) return { type: findedInfo.devName as any, desc: findedInfo.name[0] };

    const pushType = studentNameAlias.includes(studentName)
        ? '待整理数据库已存在该别名'
        : '待整理数据库未存在，已推送';
    if (!studentNameAlias.includes(studentName)) studentNameAlias.push(studentName);

    const fuzzySearch = await import('./studentInfo').then((m) =>
        m.sutdentNameFuzzySearch(studentName, fuzzyLimit),
    );

    await sendToAdmin(
        `未找到『${studentName}』数据 ${pushType}\n${fuzzySearch.map((v) => `${v.id}(${v.name}): ${v.pinyin}-${v.score}`).join('\n')}`,
    ).catch((err) => log.error('handbookMatches.studentEvaluation', err));

    if (fuzzySearch.length)
        return { type: HandbookMatches.Type.FUZZY, desc: '模糊搜索', fuzzy: fuzzySearch };
    throw `未找到『${studentName}』数据，模糊搜索失败，${pushType}`;
}

namespace HandbookInfo {
    // export interface Root {
    //     [appname: string]: {
    //         [type: string]: Data;
    //     };
    // }

    export interface Data {
        height: number;
        width: number;
        url: string;
        info?: string;
        infoUrl?: string;
        updateTime: string;
    }
}

namespace HandbookMatches {
    export interface Root {
        names: Record<string, Name>;
        types: Record<string, RegExp>;
    }
    export interface Name {
        reg: RegExp;
        typeReg: RegExp;
        has: Type[];
        desc: string;
    }
    export const enum Type {
        JP = 'jp',
        GLOBAL = 'global',
        CN = 'cn',
        ALL = 'all',
        FUZZY = 'fuzzy',
    }
}

interface HandbookMatched {
    name: string;
    nameDesc?: string;
    type: HandbookMatches.Type;
    desc: string;
    default: boolean;
    fuzzy?: SearchPinyin[];
}

namespace DiyigemtAPI {
    export interface Root {
        status: 101 | 200;
        data?: ResultList[];
        message: 'name is empty' | 'fuse search' | 'wrong name';
    }

    interface ResultList {
        id: number;
        name: string;
        path: string;
        hash: string;
        type: number;
    }
}
