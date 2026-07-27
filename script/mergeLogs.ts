/**
 * 按 bot 合并日志：
 * 1. log/ 根目录：合并历史文件到 log/save/，每个 bot 最新一份保留在 log/
 * 2. log/save/ 中尚未合并的单份日志：全部按 bot 合并（无「最新」豁免）
 *
 * 命名: {Bot}_{YYYY-MM-DD--HH:MM:SS}.log  （与 release 脚本一致）
 * 合并产物: log/save/{Bot}_merged_{firstTs}_to_{lastTs}.log
 *
 * 用法:
 *   pnpm run mergeLogs
 *   tsx script/mergeLogs.ts
 *   tsx script/mergeLogs.ts --dry-run
 */
import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream, WriteStream } from 'fs';

const LOG_DIR = path.resolve(process.cwd(), 'log');
const SAVE_DIR = path.join(LOG_DIR, 'save');
/** 单次运行日志: Bot_YYYY-MM-DD--HH:MM:SS.log */
const LOG_NAME_RE = /^([A-Za-z][A-Za-z0-9]*)_(\d{4}-\d{2}-\d{2}--\d{2}:\d{2}:\d{2})\.log$/;
const dryRun = process.argv.includes('--dry-run');

interface LogEntry {
    bot: string;
    ts: string;
    name: string;
    fullPath: string;
    size: number;
}

function formatSize(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** 列出目录下可识别的单份 bot 日志（不含 *_merged_*） */
function listBotLogsInDir(dir: string): Map<string, LogEntry[]> {
    const byBot = new Map<string, LogEntry[]>();
    if (!fs.existsSync(dir)) return byBot;

    for (const name of fs.readdirSync(dir)) {
        // 已合并产物跳过
        if (name.includes('_merged_')) continue;
        if (!name.endsWith('.log')) continue;

        const fullPath = path.join(dir, name);
        let st: fs.Stats;
        try {
            st = fs.statSync(fullPath);
        } catch {
            continue;
        }
        if (!st.isFile()) continue;

        const m = LOG_NAME_RE.exec(name);
        if (!m) {
            console.warn(`跳过无法识别的日志名: ${path.relative(LOG_DIR, fullPath)}`);
            continue;
        }

        const entry: LogEntry = {
            bot: m[1],
            ts: m[2],
            name,
            fullPath,
            size: st.size,
        };
        const list = byBot.get(entry.bot) ?? [];
        list.push(entry);
        byBot.set(entry.bot, list);
    }

    for (const list of byBot.values()) {
        list.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.name.localeCompare(b.name)));
    }
    return byBot;
}

function writeChunk(out: WriteStream, chunk: string | Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        out.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
}

function appendFileToStream(srcPath: string, out: WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
        const rs = createReadStream(srcPath);
        const onError = (err: Error) => {
            rs.destroy();
            reject(err);
        };
        rs.on('error', onError);
        out.once('error', onError);
        rs.on('end', () => {
            out.off('error', onError);
            resolve();
        });
        rs.pipe(out, { end: false });
    });
}

/**
 * @param keepLatest 为 true 时保留时间戳最新的一份不合并（用于 log/ 活跃日志）
 */
async function mergeBotEntries(
    bot: string,
    entries: LogEntry[],
    opts: { keepLatest: boolean; label: string },
): Promise<void> {
    const toMerge = opts.keepLatest ? entries.slice(0, -1) : entries;
    const latest = opts.keepLatest ? entries[entries.length - 1] : null;

    if (toMerge.length === 0) {
        console.log(`[${opts.label}/${bot}] 无可合并文件` + (latest ? `（仅最新 ${latest.name}）` : ''));
        return;
    }
    if (opts.keepLatest && entries.length <= 1) {
        console.log(`[${opts.label}/${bot}] 仅 ${entries.length} 个日志，无需合并`);
        return;
    }

    const totalSize = toMerge.reduce((s, e) => s + e.size, 0);
    const firstTs = toMerge[0].ts;
    const lastTs = toMerge[toMerge.length - 1].ts;
    const outName = `${bot}_merged_${firstTs}_to_${lastTs}.log`;
    const outPath = path.join(SAVE_DIR, outName);

    console.log(
        `[${opts.label}/${bot}]` +
            (latest ? ` 保留最新: ${latest.name} (${formatSize(latest.size)}) |` : '') +
            ` 合并 ${toMerge.length} 个 → ${outName} (${formatSize(totalSize)})`,
    );

    if (dryRun) {
        console.log(`[${opts.label}/${bot}] (dry-run) 将删除 ${toMerge.length} 个源文件`);
        return;
    }

    if (fs.existsSync(outPath)) {
        // 若目标恰与某个源文件同名不可能（源无 merged）；重名则换带序号后缀
        console.error(`[${opts.label}/${bot}] 目标已存在，中止以免覆盖: ${outPath}`);
        process.exit(1);
    }

    fs.mkdirSync(SAVE_DIR, { recursive: true });

    const out = createWriteStream(outPath, { flags: 'wx' });
    try {
        for (const entry of toMerge) {
            await writeChunk(out, `\n===== BEGIN ${entry.name} =====\n`);
            await appendFileToStream(entry.fullPath, out);
            await writeChunk(out, `\n===== END ${entry.name} =====\n`);
        }
        await new Promise<void>((resolve, reject) => {
            out.end((err) => (err ? reject(err) : resolve()));
        });
    } catch (err) {
        out.destroy();
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        throw err;
    }

    const mergedSize = fs.statSync(outPath).size;
    console.log(`[${opts.label}/${bot}] 已写入 ${outPath} (${formatSize(mergedSize)})，删除源文件…`);

    let deleted = 0;
    for (const entry of toMerge) {
        try {
            fs.unlinkSync(entry.fullPath);
            deleted++;
        } catch (err) {
            console.error(`[${opts.label}/${bot}] 删除失败 ${entry.name}:`, err);
        }
    }
    console.log(`[${opts.label}/${bot}] 已删除 ${deleted}/${toMerge.length} 个源文件`);
}

async function mergeDir(dir: string, keepLatest: boolean, label: string): Promise<void> {
    const byBot = listBotLogsInDir(dir);
    if (byBot.size === 0) {
        console.log(`[${label}] 无待处理单份日志`);
        return;
    }
    for (const bot of [...byBot.keys()].sort()) {
        await mergeBotEntries(bot, byBot.get(bot)!, { keepLatest, label });
    }
}

async function main() {
    console.log(`log 目录: ${LOG_DIR}`);
    console.log(`save 目录: ${SAVE_DIR}`);
    if (dryRun) console.log('模式: dry-run（不写不删）');
    if (!fs.existsSync(LOG_DIR)) {
        console.error(`log 目录不存在: ${LOG_DIR}`);
        process.exit(1);
    }

    // 1) log/ 根：保留每个 bot 最新一份
    console.log('\n--- 处理 log/ 根目录（保留最新）---');
    await mergeDir(LOG_DIR, true, 'log');

    // 2) log/save/ 中仍以单文件形式存放的历史日志：全部合并
    console.log('\n--- 处理 log/save/ 中未合并的单份日志 ---');
    await mergeDir(SAVE_DIR, false, 'save');

    console.log('\n完成');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
