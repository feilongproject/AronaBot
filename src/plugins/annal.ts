import axios from 'axios';
import { IMessageGROUP } from '../libs/IMessageEx';
import config from '../../config/config';

// 允许使用图库功能的真实群号
const allowGroup = [
    '1041893514', // 测试大群
    '786830134', // Copper Archive
    '577899701', // 阿罗普拉之家
];

const TABLE_NAME = 'group_named_gallery';

let initTablePromise: Promise<any> | null = null;
function initTable() {
    if (!initTablePromise) {
        initTablePromise = mariadb.query(`
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
	id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	gid VARCHAR(64) NOT NULL,
	gallery_name VARCHAR(100) NOT NULL,
	cos_key VARCHAR(255) NOT NULL,
	aid VARCHAR(64) NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_gid_gallery (gid, gallery_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);
    }
    return initTablePromise;
}

function getGalleryName(content: string, command: '添加' | '来点'): { name: string } | 'empty' | 'illegal' {
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

    await initTable();
    await mariadb.query(
        `INSERT INTO ${TABLE_NAME} (gid, gallery_name, cos_key, aid) VALUES (?, ?, ?, ?)`,
        [realGid, galleryName, cosKey, msg.author.id],
    );

    const countRows: { count: number }[] = await mariadb.query(
        `SELECT COUNT(1) AS count FROM ${TABLE_NAME} WHERE gid = ? AND gallery_name = ?`,
        [realGid, galleryName],
    );
    const count = countRows[0]?.count || 0;
    return msg.sendMsgEx(`已添加到图库「${galleryName}」，当前共 ${count} 张`);
}

export async function randomNamedGalleryImage(msg: IMessageGROUP) {
    const realGid = resolveAndCheck(msg);
    if (!realGid) return;

    const galleryResult = getGalleryName(msg.content, '来点');
    if (galleryResult === 'empty') return msg.sendMsgEx('用法：来点xxx');
    if (galleryResult === 'illegal') return msg.sendMsgEx('图库名称含有非法字符，请更换名称');
    const galleryName = galleryResult.name;

    await initTable();
    const rows: { cos_key: string }[] = await mariadb.query(
        `SELECT cos_key FROM ${TABLE_NAME} WHERE gid = ? AND gallery_name = ? ORDER BY RAND() LIMIT 1`,
        [realGid, galleryName],
    );
    const key = rows[0]?.cos_key;
    if (!key) return msg.sendMsgEx(`图库「${galleryName}」为空`);

    return msg.sendMsgEx({  imageUrl: cosUrl(key) });
}

export async function listGalleries(msg: IMessageGROUP) {
    const realGid = resolveAndCheck(msg);
    if (!realGid) return;

    await initTable();
    const rows: { gallery_name: string; count: number }[] = await mariadb.query(
        `SELECT gallery_name, COUNT(1) AS count FROM ${TABLE_NAME} WHERE gid = ? GROUP BY gallery_name ORDER BY count DESC`,
        [realGid],
    );
    if (!rows.length) return msg.sendMsgEx('当前群暂无图库');

    const list = rows.map((r, i) => `${i + 1}. ${r.gallery_name}（${r.count}张）`).join('\n');
    return msg.sendMsgEx(`当前群图库列表：\n${list}`);
}
