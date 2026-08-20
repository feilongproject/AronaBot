/**
 * 对 chatSticker 图库全量/按条件重新 vision 打标：
 * summary + tags + emotionTags + styleTags + nsfwRisk + isMeme
 *
 * 用法：
 *   pnpm retag:stickers
 *   pnpm retag:stickers -- --dry-run
 *   pnpm retag:stickers -- --status ready,pending
 *   pnpm retag:stickers -- --limit 10
 *   pnpm retag:stickers -- --concurrency 2
 *   pnpm retag:stickers -- --only-missing   # 仅缺 emotionTags 的条目
 *   pnpm retag:stickers -- --id <hash>
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import COS from 'cos-nodejs-sdk-v5';
import imageSize from 'image-size';
import { MongoClient } from 'mongodb';
import { visionSummarize, VisionInputImage } from '../src/plugins/chatbot/models';
import type { ChatbotRuntimeConfig } from '../src/plugins/chatbot/config';

const ROOT = process.cwd();
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/settings.json'), 'utf-8'));
const aiConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/ai.json'), 'utf-8'));

// visionSummarize 依赖全局 log
const logFn = (level: string) => (...args: unknown[]) => {
    const msg = args
        .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
        .join(' ');
    // eslint-disable-next-line no-console
    console.log(`[${level}] ${msg}`);
};
(global as any).log = {
    trace: logFn('TRACE'),
    debug: logFn('DEBUG'),
    info: logFn('INFO'),
    warn: logFn('WARN'),
    error: logFn('ERROR'),
    mark: logFn('MARK'),
};
(global as any).devEnv = true;

function parseArgs(argv: string[]) {
    const flags = new Set<string>();
    const opts: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') flags.add('dryRun');
        else if (a === '--only-missing') flags.add('onlyMissing');
        else if (a === '--status' && argv[i + 1]) opts.status = argv[++i];
        else if (a === '--limit' && argv[i + 1]) opts.limit = argv[++i];
        else if (a === '--concurrency' && argv[i + 1]) opts.concurrency = argv[++i];
        else if (a === '--id' && argv[i + 1]) opts.id = argv[++i];
        else if (a === '--skip' && argv[i + 1]) opts.skip = argv[++i];
        else if (a.startsWith('--')) flags.add(a.slice(2));
    }
    return {
        dryRun: flags.has('dryRun'),
        onlyMissing: flags.has('onlyMissing'),
        status: opts.status || '', // 空=全部状态
        limit: Math.max(0, Number(opts.limit) || 0),
        skip: Math.max(0, Number(opts.skip) || 0),
        concurrency: Math.max(1, Math.min(4, Number(opts.concurrency) || 1)),
        id: opts.id || '',
    };
}

function mongoUri(cfg: { user: string; password: string; database: string; authSource?: string }) {
    const authSource = cfg.authSource || cfg.database;
    return `mongodb://${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.password)}@${
        settings.mongo.host
    }:${settings.mongo.port}/${cfg.database}?authSource=${encodeURIComponent(authSource)}`;
}

function extOf(cosKey: string, contentType?: string): string {
    const fromKey = (cosKey.split('.').pop() || '').toLowerCase();
    if (fromKey && fromKey.length <= 5) return fromKey.replace('jpeg', 'jpg');
    const mime = (contentType || '').toLowerCase();
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    return 'png';
}

function mimeOf(ext: string): string {
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    return 'image/png';
}

async function downloadCosObject(
    cos: COS,
    key: string,
): Promise<{ buffer: Buffer; mime: string; ext: string }> {
    const Bucket = settings.cos.Bucket;
    const Region = settings.cos.Region;
    const data = await new Promise<COS.GetObjectResult>((resolve, reject) => {
        cos.getObject({ Bucket, Region, Key: key }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });
    const body = data.Body;
    let buffer: Buffer;
    if (Buffer.isBuffer(body)) buffer = body;
    else if (typeof body === 'string') buffer = Buffer.from(body);
    else if (body && typeof (body as any).pipe === 'function') {
        // stream
        const chunks: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Buffer | string>) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        buffer = Buffer.concat(chunks);
    } else {
        throw new Error(`unexpected COS body type for ${key}`);
    }
    const headers = (data.headers || {}) as Record<string, string>;
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    const ext = extOf(key, contentType);
    return { buffer, mime: contentType || mimeOf(ext), ext };
}

/** 回退：签名 URL 下载 */
async function downloadViaUrl(key: string): Promise<{ buffer: Buffer; mime: string; ext: string }> {
    const cos = new COS(settings.cos);
    const authKey = cos.getAuth({ Method: 'GET', Key: key, Expires: 300 });
    const base = String(settings.cosUrl || '').replace(/\/+$/, '');
    const url = `${base}/${key}?${authKey}`;
    const res = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        },
    });
    const buffer = Buffer.from(res.data);
    const contentType = String(res.headers['content-type'] || '');
    const ext = extOf(key, contentType);
    return { buffer, mime: contentType || mimeOf(ext), ext };
}

async function loadImage(cos: COS, cosKey: string): Promise<VisionInputImage> {
    let file: { buffer: Buffer; mime: string; ext: string };
    try {
        file = await downloadCosObject(cos, cosKey);
    } catch (err) {
        console.warn(`  COS getObject 失败，改用 URL: ${(err as Error).message}`);
        file = await downloadViaUrl(cosKey);
    }
    let width: number | undefined;
    let height: number | undefined;
    try {
        const size = imageSize(file.buffer);
        width = size.width;
        height = size.height;
    } catch {
        // ignore
    }
    return {
        buffer: file.buffer,
        mime: file.mime,
        ext: file.ext,
        width,
        height,
    };
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function mapPool<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return results;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const aiMongo = aiConfig.mongo;
    if (!aiMongo) {
        console.error('config/ai.json 缺少 mongo 配置');
        process.exit(1);
    }
    const visionApiKey = String(aiConfig.chatbot?.visionApiKey || '').trim();
    if (!visionApiKey) {
        console.error('config/ai.json chatbot.visionApiKey 为空，无法打标');
        process.exit(1);
    }

    const cfg = {
        visionApiKey,
        visionBaseURL:
            aiConfig.chatbot?.visionBaseURL ||
            'https://dashscope.aliyuncs.com/compatible-mode/v1',
        visionModel: aiConfig.chatbot?.visionModel || 'qwen3.7-plus',
        visionStructuredOutput: aiConfig.chatbot?.visionStructuredOutput !== false,
    } as ChatbotRuntimeConfig;

    const client = new MongoClient(mongoUri(aiMongo), { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const col = client.db(aiMongo.database).collection('chatSticker');
    const cos = new COS(settings.cos);

    const filter: Record<string, unknown> = {};
    if (args.id) {
        filter._id = args.id;
    } else {
        if (args.status) {
            const statuses = args.status
                .split(/[,，\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            if (statuses.length === 1) filter.status = statuses[0];
            else if (statuses.length > 1) filter.status = { $in: statuses };
        }
        if (args.onlyMissing) {
            filter.$or = [
                { emotionTags: { $exists: false } },
                { emotionTags: { $size: 0 } },
                { emotionTags: null },
            ];
        }
    }

    let cursor = col.find(filter).sort({ ts: -1 });
    if (args.skip) cursor = cursor.skip(args.skip);
    if (args.limit) cursor = cursor.limit(args.limit);
    const docs = await cursor.toArray();
    const totalAll = await col.countDocuments(filter);

    console.log(
        [
            `图库重打标`,
            `filter=${JSON.stringify(filter)}`,
            `待处理=${docs.length}/${totalAll}`,
            `concurrency=${args.concurrency}`,
            args.dryRun ? 'DRY-RUN' : 'WRITE',
            `model=${cfg.visionModel}`,
        ].join(' | '),
    );

    if (!docs.length) {
        console.log('无匹配条目');
        await client.close();
        return;
    }

    let ok = 0;
    let fail = 0;
    let skipped = 0;

    await mapPool(docs, args.concurrency, async (doc, index) => {
        const id = String(doc._id);
        const cosKey = String(doc.cosKey || '');
        const prefix = `[${index + 1}/${docs.length}] ${id.slice(0, 10)}`;
        if (!cosKey) {
            console.warn(`${prefix} 无 cosKey，跳过`);
            skipped++;
            return;
        }
        try {
            const img = await loadImage(cos, cosKey);
            const results = await visionSummarize([img], cfg);
            const result = results?.[0];
            if (!result) {
                console.warn(`${prefix} vision 无结果`);
                fail++;
                return;
            }
            const patch = {
                summary: result.summary || doc.summary || '',
                tags: result.tags,
                emotionTags: result.emotionTags,
                styleTags: result.styleTags,
                sceneTags: result.sceneTags,
                contentTags: result.contentTags,
                subjectTags: result.subjectTags,
                nsfwRisk: result.nsfwRisk,
                isMeme: result.isMeme,
                retaggedAt: new Date(),
                retagModel: cfg.visionModel,
            };
            console.log(
                `${prefix} emo=[${result.emotionTags.join(',')}] style=[${result.styleTags.join(
                    ',',
                )}] scene=[${result.sceneTags.join(',')}] content=[${result.contentTags.join(
                    ',',
                )}] subject=[${result.subjectTags.join(',')}] summary=${result.summary.slice(0, 40)}`,
            );
            if (!args.dryRun) {
                await col.updateOne({ _id: doc._id }, { $set: patch });
            }
            ok++;
            // 轻微节流，降低 vision 限流概率
            await sleep(200);
        } catch (err) {
            console.error(`${prefix} 失败:`, (err as Error).message || err);
            fail++;
            await sleep(500);
        }
    });

    console.log(
        `完成: ok=${ok} fail=${fail} skipped=${skipped} total=${docs.length}${
            args.dryRun ? ' (dry-run 未写库)' : ''
        }`,
    );
    await client.close();
    if (fail) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
