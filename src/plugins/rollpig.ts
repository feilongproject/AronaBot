import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import * as puppeteer from 'puppeteer';
import { IMessageGROUP } from '../libs/IMessageEx';
import config from '../../config/config';

// ================================ 模块级配置 ================================
const RES_DIR = `${global._path}/data/rollpig`;
const PIG_JSON_PATH = `${RES_DIR}/pig.json`;
const TEMPLATE_PATH = `${RES_DIR}/template.html`;
const IMAGE_DIR = `${RES_DIR}/images`;
const CACHE_DIR = `${RES_DIR}/cache`;
const ALLOWED_IMAGE_SUFFIXES = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

/** 云端资源同步配置 */
const ROLLPIG_CONFIG = {
    resourceSyncEnabled: true,
    manifestUrl: 'https://pig.felislab.cc/resources/rollpig/manifest.json',
    syncIntervalHours: 24,
    syncTimeout: 10.0,
    maxFileSize: 10 * 1024 * 1024,
};

const PIGHUB_API = 'https://pighub.top/api/all-images';
const PIGHUB_IMAGE_BASE = 'https://pighub.top/data/';

// ================================ 类型定义 ================================
interface Pigsonality {
    id: string;
    name: string;
    description: string;
    analysis: string;
}

interface PigInfo {
    id: string;
    title: string;
    image_type: string;
    view_count: number;
    download_count: number;
    thumbnail: string;
    duration: string;
    filename: string;
    mtime: number;
}

interface PigRecord {
    pig_id: string;
    date: string;
}

// ================================ 内部状态 ================================
let pigPool: Pigsonality[] = [];
let pigHubCache: PigInfo[] = [];
let pigHubLastFetch = 0;
const PIGHUB_CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存

// ================================ 初始化 ================================
function loadPigPool(): void {
    try {
        const raw = fs.readFileSync(PIG_JSON_PATH, 'utf-8');
        pigPool = JSON.parse(raw) as Pigsonality[];
        log.info(`rollpig: 已加载 ${pigPool.length} 条今日小猪记录`);
    } catch (err) {
        log.error('rollpig: 加载 pig.json 失败', err);
        pigPool = [];
    }
}

// 启动时加载
loadPigPool();

// ================================ 辅助函数 ================================
function getTodayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function findPigImage(pigId: string): string | null {
    for (const suffix of ALLOWED_IMAGE_SUFFIXES) {
        const imagePath = `${IMAGE_DIR}/${pigId}${suffix}`;
        if (fs.existsSync(imagePath)) return imagePath;
    }
    return null;
}

async function getPigHubData(): Promise<PigInfo[]> {
    const now = Date.now();
    if (pigHubCache.length > 0 && now - pigHubLastFetch < PIGHUB_CACHE_TTL) {
        return pigHubCache;
    }

    try {
        const res = await axios.get(PIGHUB_API, { timeout: 30000 });
        const data = res.data;
        if (data && data.images) {
            pigHubCache = data.images.map((pig: any) => ({
                id: String(pig.id || ''),
                title: pig.title || '',
                image_type: pig.image_type || '',
                view_count: pig.view_count || 0,
                download_count: pig.download_count || 0,
                thumbnail: pig.thumbnail || '',
                duration: pig.duration || '',
                filename: pig.filename || '',
                mtime: pig.mtime || 0,
            }));
            pigHubLastFetch = now;
            log.info(`rollpig: 从 PigHub 缓存了 ${pigHubCache.length} 头猪猪`);
        }
    } catch (err) {
        log.warn('rollpig: PigHub API 请求失败', err);
    }
    return pigHubCache;
}

// ================================ HTML 渲染 ================================
async function renderPigHTML(pig: Pigsonality): Promise<Buffer> {
    const avatarPath = findPigImage(pig.id);
    let template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

    let avatarUri = '';
    if (avatarPath) {
        const imageBuffer = fs.readFileSync(avatarPath);
        const ext = avatarPath.split('.').pop() || 'png';
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        avatarUri = `data:image/${mime};base64,${imageBuffer.toString('base64')}`;
    }

    template = template
        .replace('__AVATAR__', avatarUri)
        .replace('__NAME__', pig.name)
        .replace('__DESC__', pig.description)
        .replace('__ANALYSIS__', pig.analysis);

    if (!global.browser) {
        global.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
    }

    const page = await global.browser.newPage();
    try {
        await page.setViewport({ width: 800, height: 800 });
        await page.setContent(template, { waitUntil: 'networkidle0', timeout: 15000 });
        const imageBuffer = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
        return imageBuffer;
    } finally {
        await page.close();
    }
}

// ================================ Redis 记录 ================================
async function getUserRecord(userId: string): Promise<PigRecord | null> {
    const raw = await redis.get(`rollpig:record:${userId}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as PigRecord;
    } catch {
        return null;
    }
}

async function saveUserRecord(userId: string, pigId: string): Promise<void> {
    const record: PigRecord = {
        pig_id: pigId,
        date: getTodayStr(),
    };
    // 设置过期时间为次日凌晨
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ttlSeconds = Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
    await redis.set(`rollpig:record:${userId}`, JSON.stringify(record), { EX: ttlSeconds });
}

// ================================ 公开命令函数 ================================

/**
 * 今日小猪 - 抽取今天属于你的小猪人格
 * 用法：今日小猪 / 今天是什么小猪 / 本日小猪 / 当日小猪
 */
export async function todayPig(msg: IMessageGROUP): Promise<any> {
    const userId = msg.author.id;

    // 检查今日是否已抽取
    const todayRecord = await getUserRecord(userId);
    if (todayRecord && todayRecord.date === getTodayStr()) {
        const cachedPig = pigPool.find((p) => p.id === todayRecord.pig_id);
        if (cachedPig) {
            return sendPigImage(msg, cachedPig);
        }
    }

    // 重新加载猪池（支持热更新）
    if (pigPool.length === 0) loadPigPool();
    if (pigPool.length === 0) {
        return msg.sendMarkdown({
            content: '猪圈空荡荡，没有可抽取的小猪...',
            keyboardNameId: 'rollpig',
        });
    }

    // 随机抽取
    const pig = pigPool[crypto.randomInt(0, pigPool.length)];
    await saveUserRecord(userId, pig.id);

    return sendPigImage(msg, pig);
}

/**
 * 随机小猪 - 从 PigHub 随机获取猪猪图
 * 用法：随机小猪 [数量]
 */
export async function randomPig(msg: IMessageGROUP): Promise<any> {
    const countMatch = msg.content.replaceAll(/<!?@[A-Z0-9]+>/g, '').match(/(\d+)/);
    const count = Math.min(Math.max(1, countMatch ? parseInt(countMatch[1]) : 1), 20);

    const pigs = await getPigHubData();
    if (pigs.length === 0) {
        return msg.sendMarkdown({
            content: '猪圈空荡荡，PigHub 上暂无猪猪...',
            keyboardNameId: 'rollpig',
        });
    }

    const selected: PigInfo[] = [];
    const pool = [...pigs];
    for (let i = 0; i < Math.min(count, pool.length); i++) {
        const idx = crypto.randomInt(0, pool.length);
        selected.push(pool.splice(idx, 1)[0]);
    }

    if (selected.length === 1) {
        const pig = selected[0];
        const imageUrl = PIGHUB_IMAGE_BASE + pig.thumbnail.split('/').pop();
        return msg.sendMarkdown({
            content: `${pig.title} (ID: ${pig.id})\n![img #600px #600px](${imageUrl})`,
            keyboardNameId: 'rollpig',
        });
    }

    // 多张图片：逐张发送
    for (const pig of selected) {
        const imageUrl = PIGHUB_IMAGE_BASE + pig.thumbnail.split('/').pop();
        await msg.sendMarkdown({
            content: `${pig.title} (ID: ${pig.id})\n![img #600px #600px](${imageUrl})`,
            keyboardNameId: 'rollpig',
        });
        await sleep(1000);
    }
}

/**
 * 找猪 - 根据关键词或ID查找猪猪
 * 用法：找猪 [关键词] [-i|--id 图片ID]
 */
export async function findPig(msg: IMessageGROUP): Promise<any> {
    const content = msg.content
        .replaceAll(/<!?@[A-Z0-9]+>/g, '')
        .replace(/^\/?找猪|搜猪/, '')
        .trim();

    // 解析 -i / --id / id 参数
    const idMatch = content.match(/(?:-i|--id|id)\s*(\d+)/);
    const idSearch = idMatch ? idMatch[1] : null;
    const keyword = content.replace(/(?:-i|--id|id)\s*\d+/, '').trim();

    const pigs = await getPigHubData();
    if (pigs.length === 0) {
        return msg.sendMarkdown({ content: '猪圈空荡荡...', keyboardNameId: 'rollpig' });
    }

    let foundPigs: PigInfo[] = [];

    if (idSearch) {
        foundPigs = pigs.filter((pig) => pig.id === idSearch);
    } else if (keyword) {
        const kw = keyword.toLowerCase();
        foundPigs = pigs.filter((pig) => pig.title.toLowerCase().includes(kw));
    } else {
        return msg.sendMarkdown({
            content: '请输入关键词或图片ID~\n用法：找猪 <关键词> 或 找猪 -i <图片ID>',
            keyboardNameId: 'rollpig',
        });
    }

    if (foundPigs.length === 0) {
        return msg.sendMarkdown({ content: '你要找的猪仔离家出走了~', keyboardNameId: 'rollpig' });
    }

    const limit = foundPigs.slice(0, 20);
    if (limit.length === 1) {
        const pig = limit[0];
        const imageUrl = PIGHUB_IMAGE_BASE + pig.thumbnail.split('/').pop();
        return msg.sendMarkdown({
            content: `${pig.title} (ID: ${pig.id})\n![img #600px #600px](${imageUrl})`,
            keyboardNameId: 'rollpig',
        });
    }

    // 多结果
    const resultList = limit.map((pig) => `${pig.title} (ID: ${pig.id})`).join('\n');
    return msg.sendMarkdown({
        content: `找到 ${foundPigs.length} 头猪猪，显示前 ${limit.length} 个：\n${resultList}`,
        keyboardNameId: 'rollpig',
    });
}

/**
 * 同步小猪资源 - 管理员从云端同步资源
 * 用法：同步小猪资源 / 刷新小猪图鉴
 */
export async function syncPigResources(msg: IMessageGROUP): Promise<any> {
    const userId = msg.author.id;
    if (!global.adminId.includes(userId)) {
        return msg.sendMarkdown({
            content: '只有超级管理员可以同步小猪资源。',
            keyboardNameId: 'rollpig',
        });
    }

    try {
        const result = await syncFromRemote();
        loadPigPool(); // 重新加载猪池
        return msg.sendMarkdown({
            content: `${result}\n当前小猪数量：${pigPool.length}`,
            keyboardNameId: 'rollpig',
        });
    } catch (err) {
        log.error('rollpig: 小猪资源手动同步失败', err);
        return msg.sendMarkdown({ content: `小猪资源同步失败：${err}`, keyboardNameId: 'rollpig' });
    }
}

// ================================ 内部：发送今日小猪图片 ================================
async function sendPigImage(msg: IMessageGROUP, pig: Pigsonality): Promise<any> {
    try {
        // 检查本地缓存，避免重复渲染
        const cachePath = `${CACHE_DIR}/${pig.id}.png`;
        let imageBuffer: Buffer;

        if (fs.existsSync(cachePath)) {
            imageBuffer = fs.readFileSync(cachePath);
        } else {
            imageBuffer = await renderPigHTML(pig);
            if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(cachePath, imageBuffer);
        }

        const imageName = `rollpig-${pig.id}-${Date.now()}.png`;
        const localPath = `${config.imagesOut}/${imageName}`;
        fs.writeFileSync(localPath, imageBuffer);

        await cosPutObject({
            Key: `rollpig/${imageName}`,
            Body: imageBuffer,
            ContentLength: imageBuffer.length,
        });

        const imageUrl = cosUrl(`rollpig/${imageName}`);
        return msg.sendMarkdown({
            content:
                `<@${msg.author.id}> 今天你是：${pig.name}\n` + `![img #800px #800px](${imageUrl})`,
            keyboardNameId: 'rollpig',
        });
    } catch (err) {
        log.error('rollpig: 渲染今日小猪图片失败', err);
        // 降级：纯文本发送
        return msg.sendMarkdown({
            content:
                `<@${msg.author.id}> 今天你是：${pig.name}\n` +
                `${pig.description}\n` +
                `${pig.analysis}`,
            keyboardNameId: 'rollpig',
        });
    }
}

// ================================ 内部：云端资源同步 ================================
async function syncFromRemote(): Promise<string> {
    const manifestUrl = ROLLPIG_CONFIG.manifestUrl;
    if (!manifestUrl) return '未配置资源 manifest URL';

    const timeout = Math.max(1, ROLLPIG_CONFIG.syncTimeout) * 1000;
    const maxSize = ROLLPIG_CONFIG.maxFileSize;

    // 下载 manifest
    const manifestRes = await axios.get(manifestUrl, {
        timeout,
        responseType: 'json',
    });
    const manifest = manifestRes.data;
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('manifest 格式错误');
    }

    const resourceVersion = String(manifest.resource_version || '').trim();
    if (!resourceVersion) {
        throw new Error('manifest 缺少 resource_version');
    }

    // 检查是否需要更新
    const stateKey = 'rollpig:resource_version';
    const currentVersion = (await redis.get(stateKey)) || '';
    if (resourceVersion === currentVersion) {
        return `小猪资源已是最新：${resourceVersion}`;
    }

    // 下载 pig_json
    const pigJsonMeta = manifest.pig_json;
    if (!pigJsonMeta || typeof pigJsonMeta !== 'object') {
        throw new Error('manifest 缺少 pig_json');
    }
    await downloadFile(manifestUrl, pigJsonMeta, PIG_JSON_PATH, maxSize);

    // 验证 pig.json
    const pigData = JSON.parse(fs.readFileSync(PIG_JSON_PATH, 'utf-8'));
    if (!Array.isArray(pigData)) throw new Error('pig.json 必须是数组');

    // 下载 images
    const imageItems = manifest.images;
    if (Array.isArray(imageItems)) {
        if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

        for (const item of imageItems) {
            if (!item || typeof item !== 'object') continue;
            const filename =
                String(item.filename || '') ||
                String(item.path || '')
                    .split('/')
                    .pop() ||
                '';
            if (!filename) continue;
            const targetPath = `${IMAGE_DIR}/${filename}`;
            await downloadFile(manifestUrl, item, targetPath, maxSize);
        }
    }

    // 更新版本号
    await redis.set(stateKey, resourceVersion);
    return `小猪资源同步完成：${resourceVersion}`;
}

async function downloadFile(
    manifestUrl: string,
    meta: any,
    targetPath: string,
    maxSize: number,
): Promise<void> {
    const path = String(meta.path || '').trim();
    if (!path) throw new Error('manifest 文件条目缺少 path');

    const url = new URL(path, manifestUrl).href;
    const res = await axios.get(url, {
        timeout: ROLLPIG_CONFIG.syncTimeout * 1000,
        responseType: 'arraybuffer',
    });

    const content = Buffer.from(res.data);
    const expectedSize = parseInt(String(meta.size || '0'), 10);

    if (content.length > maxSize) {
        throw new Error(`资源文件过大: ${path} (${content.length} > ${maxSize})`);
    }
    if (expectedSize && content.length !== expectedSize) {
        throw new Error(`资源文件大小不匹配: ${path} (${content.length} != ${expectedSize})`);
    }

    const expectedSha256 = String(meta.sha256 || '')
        .toLowerCase()
        .trim();
    if (expectedSha256) {
        const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
        if (actualSha256 !== expectedSha256) {
            throw new Error(`资源文件 sha256 不匹配: ${path}`);
        }
    }

    const dir = targetPath.substring(0, targetPath.lastIndexOf('/'));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, content);
}
