import axios from 'axios';
import type { Collection } from 'mongodb';
import { IMessageGROUP } from '../libs/IMessageEx';
import config from '../../config/config';

// 允许使用图库功能的真实群号
const allowGroup = [
    '1041893514', // 已弃用群
    '874688335', // 测试小群
    // '786830134', // Copper Archive
    '577899701', // 阿罗普拉之家
];

const TABLE_NAME = 'group_named_gallery';

/** 保持原 MariaDB 表结构：id / gid / gallery_name / cos_key / aid / created_at */
interface NamedGalleryDoc {
    /** 与自增 id 对应的字符串主键（迁移数据 _id = String(id)） */
    _id: string;
    /** 自增主键（延续原表 AUTO_INCREMENT 语义） */
    id: number;
    /** 真实群号（groupMap 映射后的群号） */
    gid: string;
    gallery_name: string;
    cos_key: string;
    /** 上传者 id */
    aid: string;
    created_at: Date;
}

function collection(): Collection<NamedGalleryDoc> {
    if (!global.mongoDb) throw new Error('mongodb 未初始化，图库不可用');
    return global.mongoDb.collection<NamedGalleryDoc>(TABLE_NAME);
}

/** 幂等建索引，与原表 INDEX idx_gid_gallery (gid, gallery_name) 及迁移数据现有索引一致 */
let initIndexPromise: Promise<unknown> | null = null;
function ensureIndexes(col: Collection<NamedGalleryDoc>) {
    if (!initIndexPromise) {
        initIndexPromise = (async () => {
            // 清理历史误建的 group_id 索引（数据结构保持 gid 原样）
            const names = (await col.indexes()).map((i) => i.name);
            if (names.includes('group_id_1_gallery_name_1')) {
                await col.dropIndex('group_id_1_gallery_name_1').catch((err) => {
                    log.error('drop group_named_gallery index failed', err);
                });
            }
            await Promise.all([
                col.createIndex({ gid: 1, gallery_name: 1 }),
                col.createIndex({ aid: 1 }),
            ]);
        })().catch((err) => {
            initIndexPromise = null;
            throw err;
        });
    }
    return initIndexPromise;
}

/** 模拟原表自增主键：取当前最大 id + 1；并发导致 _id 冲突时重试 */
async function insertWithAutoId(
    col: Collection<NamedGalleryDoc>,
    doc: Omit<NamedGalleryDoc, '_id' | 'id'>,
): Promise<number> {
    for (let retry = 0; retry < 5; retry++) {
        const last = await col.find().sort({ id: -1 }).limit(1).project({ id: 1 }).next();
        const id = (last?.id ?? 0) + 1;
        try {
            await col.insertOne({ ...doc, _id: String(id), id });
            return id;
        } catch (err) {
            if ((err as { code?: number })?.code === 11000) continue;
            throw err;
        }
    }
    throw new Error(`${TABLE_NAME} 自增 id 分配失败`);
}

function getGalleryName(
    content: string,
    command: '添加' | '来点',
): { name: string } | 'empty' | 'illegal' {
    const name = content.replace(new RegExp(`^/?\\s*${command}`), '').trim();
    if (!name) return 'empty';
    if (/[\/\\:*?"<>|&;%#\x00-\x1f]/.test(name)) return 'illegal';
    return { name };
}

/** 通过 groupMap 将 openid 转为真实群号，并校验是否在白名单内 */
function resolveAndCheck(msg: IMessageGROUP): string | null {
    const realGid = config.bots[botType].groupMap[msg.group_id];
    if (!realGid || !allowGroup.includes(realGid)) return null;
    return realGid;
}

export async function addNamedGalleryImage(msg: IMessageGROUP) {
    const realGid = resolveAndCheck(msg);
    if (!realGid) return;

    const galleryResult = getGalleryName(msg.clean_content, '添加');
    log.debug('galleryResult', galleryResult);
    if (galleryResult === 'empty') return msg.sendMsgEx('用法：添加xxx（并附带1张图片）');
    if (galleryResult === 'illegal') return msg.sendMsgEx('图库名称含有非法字符，请更换名称');
    const galleryName = galleryResult.name;

    const image = msg.attachments?.[0];
    if (!image?.url) return msg.sendMsgEx('请在指令消息中附带1张图片');

    // 下载图片并上传到 COS，避免原始链接过期
    const imageBuffer: Buffer = await axios({
        url: image.url,
        responseType: 'arraybuffer',
    }).then((res) => Buffer.from(res.data));

    const cosKey = `annal/${realGid}/${galleryName}/${Date.now()}-${msg.author.id}.png`;
    await cosPutObject({
        Key: cosKey,
        Body: imageBuffer,
        ContentLength: imageBuffer.length,
    });

    const col = collection();
    await ensureIndexes(col);
    await insertWithAutoId(col, {
        gid: realGid,
        gallery_name: galleryName,
        cos_key: cosKey,
        aid: msg.author.id,
        created_at: new Date(),
    });

    const count = await col.countDocuments({ gid: realGid, gallery_name: galleryName });
    return msg.sendMsgEx(`已添加到图库「${galleryName}」，当前共 ${count} 张`);
}

export async function randomNamedGalleryImage(msg: IMessageGROUP) {
    const realGid = resolveAndCheck(msg);
    if (!realGid) return;

    const galleryResult = getGalleryName(msg.content, '来点');
    if (galleryResult === 'empty') return msg.sendMsgEx('用法：来点xxx');
    if (galleryResult === 'illegal') return msg.sendMsgEx('图库名称含有非法字符，请更换名称');
    const galleryName = galleryResult.name;

    const col = collection();
    await ensureIndexes(col);
    const doc = await col
        .aggregate<
            Pick<NamedGalleryDoc, 'cos_key'>
        >([{ $match: { gid: realGid, gallery_name: galleryName } }, { $sample: { size: 1 } }])
        .next();
    if (!doc) return msg.sendMsgEx(`图库「${galleryName}」为空`);

    return msg.sendMsgEx({ imageUrl: cosUrl(doc.cos_key) });
}

export async function listGalleries(msg: IMessageGROUP) {
    const realGid = resolveAndCheck(msg);
    if (!realGid) return;

    const col = collection();
    await ensureIndexes(col);
    const rows = await col
        .aggregate<{ gallery_name: string; count: number }>([
            { $match: { gid: realGid } },
            {
                $group: {
                    _id: '$gallery_name',
                    gallery_name: { $first: '$gallery_name' },
                    count: { $sum: 1 },
                },
            },
            // 数量优先，同名数量相同时按名称排序保证输出稳定
            { $sort: { count: -1, gallery_name: 1 } },
        ])
        .toArray();
    if (!rows.length) return msg.sendMsgEx('当前群暂无图库');

    const list = rows.map((r, i) => `${i + 1}. ${r.gallery_name}（${r.count}张）`).join('\n');
    return msg.sendMsgEx(`当前群图库列表：\n${list}`);
}
