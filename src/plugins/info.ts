import { readRawAIConfigFile, readRawConfigFile } from '../../config/config';
import { IMessageC2C, IMessageDIRECT, IMessageGROUP, IMessageGUILD } from '../libs/IMessageEx';

/** 单条消息内容上限（保留余量，避免超出 QQ 侧限制） */
const CHUNK_MAX = 1600;

/** 敏感字段名片段（按大小写/分隔符拆词后匹配） */
const SECRET_PARTS = new Set([
    'key',
    'apikey',
    'secret',
    'password',
    'passwd',
    'pwd',
    'token',
    'credential',
]);

function isSecretField(path: string): boolean {
    return path
        .split(/[^A-Za-z0-9]+/)
        .flatMap((part) =>
            part
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .toLowerCase()
                .split(' '),
        )
        .some((part) => SECRET_PARTS.has(part));
}

function maskSecretValue(value: unknown): string {
    if (value == null) return String(value);
    const text = String(value);
    if (!text) return "''";
    if (text.length <= 8) return '*'.repeat(Math.max(text.length, 4));
    return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function formatScalar(value: unknown): string {
    if (value == null) return String(value);
    if (typeof value === 'string') return value === '' ? "''" : value.replace(/\r?\n/g, ' ');
    return String(value);
}

/** 把配置递归渲染成 `路径: 值` 的可读行 */
function renderValue(value: unknown, path: string, lines: string[]): void {
    if (Array.isArray(value)) {
        if (value.length === 0) {
            lines.push(`${path}: (空)`);
            return;
        }
        const secret =
            Boolean(path) && isSecretField(path) && value.every((item) => typeof item === 'string');
        if (secret || value.every((item) => item == null || typeof item !== 'object')) {
            lines.push(`${path}: ${secret ? maskSecretValue(value.join(', ')) : value.join(', ')}`);
            return;
        }
        value.forEach((item, index) => renderValue(item, `${path}[${index}]`, lines));
        return;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) {
            lines.push(`${path}: (空)`);
            return;
        }
        for (const [key, item] of entries) {
            renderValue(item, path ? `${path}.${key}` : key, lines);
        }
        return;
    }

    const secret = Boolean(path) && isSecretField(path) && typeof value === 'string';
    lines.push(`${path}: ${secret ? maskSecretValue(value) : formatScalar(value)}`);
}

/** 优先按换行切分，找不到换行再硬切 */
function splitChunks(text: string, max = CHUNK_MAX): string[] {
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > max) {
        let cut = rest.lastIndexOf('\n', max);
        if (cut < max / 2) cut = max;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    if (rest) chunks.push(rest);
    return chunks;
}

function buildSection(title: string, value: unknown): string {
    const lines: string[] = [];
    renderValue(value, '', lines);
    return `===== ${title} =====\n${lines.join('\n')}`;
}

export async function info(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {
    if (!adminId.includes(msg.author.id))
        return msg instanceof IMessageGUILD ? undefined : msg.sendMsgEx({ content: '无权限调用' });

    let content: string;
    try {
        content = [buildSection('settings.json（密钥已打码）', readRawConfigFile())].join('\n');
    } catch (err) {
        log.error(`info 读取配置失败: ${err}`);
        return msg.sendMsgExRef({ content: `读取配置失败: ${err}` });
    }

    for (const chunk of splitChunks(content)) {
        await msg.sendMsgEx({ content: chunk });
    }
    return undefined;
}
