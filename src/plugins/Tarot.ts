import fs from 'fs';
import crypto from 'crypto';
import { IMessageC2C, IMessageGROUP } from '../libs/IMessageEx';
import config from '../../config/config';

/** 原图 461×817，聊天里缩小显示 */
const TAROT_IMG = { width: 180, height: 315 };

export async function todayTarot(msg: IMessageGROUP | IMessageC2C) {
    const nowDay = new Date().setHours(0, 0, 0, 0) / 1000;
    const nextDay = nowDay + 24 * 60 * 60;
    if (!(await redis.exists(`Tarot:${nowDay}`))) {
        await redis.hSet(`Tarot:${nowDay}`, 'next', nextDay);
        await redis.expireAt(`Tarot:${nowDay}`, nextDay);
    }

    const has = await redis.hGet(`Tarot:${nowDay}`, msg.author.id);
    const notHas = `${crypto.randomInt(0, 21 + 1)}:${crypto.randomInt(0, 5) != 0 ? 'u' : 'd'}`;
    const [num, type] = (has || notHas).split(':');
    const desc: Tarot = fs.readFileSync(`${config.images.Tarot}/Tarot.json`).json<Tarot[]>()[
        Number(num)
    ];
    const reversed = type == 'd';
    const imageUrl = cosUrl(`Tarot/${num}_${type}.png`);
    const reading = reversed ? desc.downDesc : desc.upDesc;

    return msg
        .sendMarkdown({
            content: buildTarotMarkdown(msg, !!has, desc, reversed, reading, imageUrl),
            imageUrl,
        })
        .then(() => redis.hSet(`Tarot:${nowDay}`, msg.author.id, has || notHas));
}

function latexText(value: string): string {
    return `\\text{${value.replace(/\\/g, '').replace(/[{}$]/g, '')}}`;
}

/** 英文 ruby 用 Fraktur；数学模式会吞空格，按单词拆开再拼接 */
function latexFraktur(value: string): string {
    return value
        .replace(/\\/g, '')
        .replace(/[{}$]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => `\\mathfrak{${word}}`)
        .join('\\ ');
}

function nameRuby(card: Tarot): string {
    const zh = `\\textbf{\\Large{${latexText(card.name)}}}`;
    const en = `\\Large{${latexFraktur(card.nameEn)}}`;
    return `$\\overset{${en}}{${zh}}$`;
}

function orientationBadge(reversed: boolean): string {
    const bg = reversed ? '#8E44AD' : '#16A085';
    const label = reversed ? '逆位' : '正位';
    return `$\\colorbox{${bg}}{\\color{white}{\\textbf{ ${label} }}}$`;
}

function introLine(has: boolean): string {
    return has ? '老师今天已经抽过了哦，这是今天的结果：' : '看看老师今天抽到了什么';
}

function buildTarotMarkdown(
    msg: IMessageGROUP | IMessageC2C,
    has: boolean,
    card: Tarot,
    reversed: boolean,
    reading: string,
    imageUrl: string,
): string {
    const mention = msg instanceof IMessageGROUP ? `<@${msg.author.id}> ` : '';
    return [
        `${mention}${introLine(has)}`,
        nameRuby(card),
        `![img #${TAROT_IMG.width}px #${TAROT_IMG.height}px](${imageUrl})`,
        orientationBadge(reversed),
        `> *${reading}*`,
    ].join('\n');
}

interface Tarot {
    name: string;
    nameEn: string;
    upDesc: string;
    downDesc: string;
}
