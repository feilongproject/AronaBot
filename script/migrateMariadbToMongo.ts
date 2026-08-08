import { createPool, PoolConnection } from 'mariadb';
import { MongoClient, Db, Collection } from 'mongodb';
import md5 from 'md5';
import config from '../config/config';

const KNOWN_TABLES = [
    'aiChatList',
    'biliMessage',
    'c2cMessage',
    'directMessage',
    'executeRecord',
    'groupMessage',
    'guildMessage',
    'GUILD_MEMBERS',
    'GUILD_MESSAGE_REACTIONS',
    'group_named_gallery',
];

const MESSAGE_TABLES = new Set(['guildMessage', 'directMessage', 'groupMessage', 'c2cMessage']);

const INDEX_MAP: Record<string, string[][]> = {
    aiChatList: [['hashID'], ['timestamp']],
    biliMessage: [['msgId'], ['userId'], ['pubTs']],
    c2cMessage: [['author.id']],
    directMessage: [['author.id']],
    executeRecord: [['optFather'], ['author.id'], ['timestamp']],
    groupMessage: [['author.id'], ['group_id'], ['timestamp']],
    guildMessage: [['author.id'], ['channel_id'], ['timestamp']],
    GUILD_MEMBERS: [['user.id']],
    GUILD_MESSAGE_REACTIONS: [['channel_id'], ['user_id'], ['target.id']],
    group_named_gallery: [['group_id', 'gallery_name'], ['aid']],
};

/** 各表的时间字段；迁移时按该字段升序读取，保证默认展示从旧到新 */
const TIME_COLUMNS: Record<string, string> = {
    aiChatList: 'timestamp',
    biliMessage: 'pubTs',
    c2cMessage: 'ts',
    directMessage: 'ts',
    executeRecord: 'ts',
    groupMessage: 'ts',
    guildMessage: 'ts',
    GUILD_MEMBERS: 'jts',
    group_named_gallery: 'created_at',
};

/** 迁移到 Mongo 时的字段改名：MariaDB 列名 → Mongo 字段名 */
const RENAME_COLUMNS: Record<string, string> = {
    ts: 'timestamp',
    jts: 'join_timestamp',
    gid: 'group_id',
};

type MigrateOptions = {
    bots: string[];
    tables: string[];
    dryRun: boolean;
    drop: boolean;
    batch: number;
    limit: number;
    where?: string;
};

function parseArgs(argv: string[]): MigrateOptions {
    const opts: MigrateOptions = {
        bots: [],
        tables: [],
        dryRun: false,
        drop: false,
        batch: 5000,
        limit: 0,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => argv[++i];
        switch (arg) {
            case '--bot':
                opts.bots.push(next());
                break;
            case '--table':
                opts.tables.push(next());
                break;
            case '--dry-run':
                opts.dryRun = true;
                break;
            case '--drop':
                opts.drop = true;
                break;
            case '--batch':
                opts.batch = Number(next()) || 5000;
                break;
            case '--limit':
                opts.limit = Number(next()) || 0;
                break;
            case '--where':
                opts.where = next();
                break;
            case '--help':
                console.log(
                    [
                        '用法: pnpm migrate:mongo [options]',
                        '  --bot <AronaBot|PlanaBot>   指定 bot（可多次，默认 allowMongo 的 bot）',
                        '  --table <table>             指定表（可多次，默认全部已知表）',
                        '  --dry-run                   只统计不写入',
                        '  --drop                      迁移前删除目标 collection',
                        '  --batch <n>                 批量大小，默认 5000',
                        '  --limit <n>                 每表最多迁移行数（测试用）',
                        '  --where <sql>               追加 WHERE 条件（多进程按时间范围分片）',
                    ].join('\n'),
                );
                process.exit(0);
            default:
                console.warn(`未知参数: ${arg}`);
        }
    }
    return opts;
}

function botMongoUri(bot: string): string {
    const mongo = config.bots[bot].mongo!;
    const authSource = mongo.authSource || mongo.database;
    return `mongodb://${encodeURIComponent(mongo.user)}:${encodeURIComponent(
        mongo.password,
    )}@${config.mongo.host}:${config.mongo.port}/${mongo.database}?authSource=${encodeURIComponent(authSource)}`;
}

function fmtDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}h${m}m${s}s` : m > 0 ? `${m}m${s}s` : `${s}s`;
}

function progressLine(
    bot: string,
    table: string,
    done: number,
    total: number,
    start: number,
): string {
    const pct = total > 0 ? ((done / total) * 100).toFixed(2) : '100.00';
    const elapsed = Date.now() - start;
    const rate = elapsed > 0 ? Math.round(done / (elapsed / 1000)) : 0;
    return `[${bot}] ${table}: ${done}/${total} (${pct}%) ${rate} rows/s ${fmtDuration(elapsed)}`;
}

async function tableExists(
    conn: PoolConnection,
    database: string,
    table: string,
): Promise<boolean> {
    const rows = await conn.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [database, table],
    );
    return rows.length > 0;
}

async function primaryKeys(
    conn: PoolConnection,
    database: string,
    table: string,
): Promise<string[]> {
    const rows = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'
         ORDER BY ORDINAL_POSITION`,
        [database, table],
    );
    return rows.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME);
}

function renameColumns(row: Record<string, any>): Record<string, any> {
    const doc: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
        doc[RENAME_COLUMNS[key] || key] = value;
    }
    return doc;
}

function splitCsv(value: unknown): string[] {
    if (value == null) return [];
    return String(value)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
}

/** ts 为零日期/空值时统一写成 1970-01-01，避免 Mongo Express 无法显示 */
function toTimestamp(value: unknown): unknown {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value != null && value !== '') return value;
    return new Date(0);
}

function toAuthor(aid: unknown, aName?: unknown, aAvatar?: unknown): Record<string, any> | null {
    const author: Record<string, any> = {};
    if (aid != null) author.id = String(aid);
    if (aName != null) author.username = String(aName);
    if (aAvatar != null) author.avatar = String(aAvatar);
    return Object.keys(author).length ? author : null;
}

/** 频道/私信消息：对齐 eventRec 写入的原始消息结构 */
function buildGuildChannelDoc(row: Record<string, any>): Record<string, any> {
    const doc: Record<string, any> = {};
    const author = toAuthor(row.aid, row.aName, row.aAvatar);
    if (author) doc.author = author;
    if (row.mid != null) doc.id = String(row.mid);
    if (row.gid != null) doc.guild_id = String(row.gid);
    if (row.cid != null) doc.channel_id = String(row.cid);
    if (row.cName != null) doc.channel_name = String(row.cName);
    if (row.seq != null) doc.seq = row.seq;
    if (row.content != null) doc.content = row.content;
    doc.timestamp = toTimestamp(row.ts);
    const attachments = splitCsv(row.attachments).map((url) => ({ url }));
    if (attachments.length) doc.attachments = attachments;
    if (row.refer != null && row.refer !== '') {
        doc.message_reference = { message_id: String(row.refer) };
    }
    const mentions = splitCsv(row.mentions).map((id) => ({ id }));
    if (mentions.length) doc.mentions = mentions;
    if (row.srcGid != null) doc.src_guild_id = String(row.srcGid);
    return doc;
}

/** 群/C2C 消息：对齐 eventRec 写入的原始消息结构 */
function buildChatDoc(row: Record<string, any>): Record<string, any> {
    const doc: Record<string, any> = {};
    const author = toAuthor(row.aid);
    if (author) doc.author = author;
    if (row.id != null) doc.id = String(row.id);
    if (row.gid != null) doc.group_id = String(row.gid);
    if (row.content != null) doc.content = row.content;
    doc.timestamp = toTimestamp(row.ts);
    const attachments = splitCsv(row.attachments).map((url) => ({ url }));
    if (attachments.length) doc.attachments = attachments;
    return doc;
}

/** executeRecord：对齐 eventRec 里 writeMessageDB 写入的结构 */
function buildExecuteRecordDoc(row: Record<string, any>): Record<string, any> {
    const doc: Record<string, any> = {};
    // executeRecord 约定：只保留 _id（=消息 id），不再冗余存储 eventId/mid
    const executeId = row.mid != null ? String(row.mid) : undefined;
    if (executeId != null) {
        doc._id = executeId;
    }
    if (row.type != null) doc.type = String(row.type);
    if (row.optFather != null) doc.optFather = String(row.optFather);
    if (row.optChild != null) doc.optChild = String(row.optChild);
    if (row.gid != null) doc.guild_id = String(row.gid);
    if (row.cid != null) doc.channel_id = String(row.cid);
    if (row.cName != null) doc.channel_name = String(row.cName);
    const author = toAuthor(row.aid, row.aName);
    if (author) doc.author = author;
    if (row.seq != null) doc.seq = row.seq;
    doc.timestamp = toTimestamp(row.ts);
    if (row.content != null) doc.content = row.content;
    return doc;
}

/** GUILD_MEMBERS：对齐 eventRec 写入的原始事件结构 */
function buildGuildMembersDoc(row: Record<string, any>): Record<string, any> {
    const doc: Record<string, any> = {};
    if (row.eId != null) doc.eventId = String(row.eId);
    if (row.gid != null) doc.guild_id = String(row.gid);
    if (row.jts != null) doc.joined_at = String(row.jts);
    if (row.nick != null) doc.nick = String(row.nick);
    if (row.opUserId != null) doc.op_user_id = String(row.opUserId);
    const roles = splitCsv(row.roles);
    if (roles.length) doc.roles = roles;
    const user = toAuthor(row.aid, row.aName, row.aAvatar);
    if (user) doc.user = user;
    // 实时写入原始事件里没有这两个字段，但保留原数据避免丢失
    if (row.type != null) doc.type = String(row.type);
    if (row.cts != null) doc.cts = String(row.cts);
    return doc;
}

/** GUILD_MESSAGE_REACTIONS：对齐 eventRec 写入的原始事件结构 */
function buildReactionsDoc(row: Record<string, any>): Record<string, any> {
    const doc: Record<string, any> = {};
    if (row.cid != null) doc.channel_id = String(row.cid);
    if (row.emojiId != null || row.emojiType != null) {
        doc.emoji = {};
        if (row.emojiId != null) doc.emoji.id = String(row.emojiId);
        if (row.emojiType != null) doc.emoji.type = row.emojiType;
    }
    if (row.gid != null) doc.guild_id = String(row.gid);
    if (row.targetId != null || row.targetType != null) {
        doc.target = {};
        if (row.targetId != null) doc.target.id = String(row.targetId);
        if (row.targetType != null) doc.target.type = String(row.targetType);
    }
    if (row.aid != null) doc.user_id = String(row.aid);
    return doc;
}

function buildDoc(table: string, row: Record<string, any>, primary: string[]): Record<string, any> {
    let doc: Record<string, any>;
    if (table === 'guildMessage' || table === 'directMessage') doc = buildGuildChannelDoc(row);
    else if (table === 'groupMessage' || table === 'c2cMessage') doc = buildChatDoc(row);
    else if (table === 'executeRecord') doc = buildExecuteRecordDoc(row);
    else if (table === 'GUILD_MEMBERS') doc = buildGuildMembersDoc(row);
    else if (table === 'GUILD_MESSAGE_REACTIONS') doc = buildReactionsDoc(row);
    else doc = renameColumns(row);

    if (doc._id === undefined) {
        const pk = primary.find((c) => row[c] != null);
        if (pk) {
            const value = row[pk];
            doc._id = value instanceof Date ? value.toISOString() : String(value);
        } else {
            doc._id = md5(JSON.stringify(row));
        }
    }
    return doc;
}

async function writeBatch(
    collection: Collection<Record<string, any>>,
    docs: Record<string, any>[],
    dryRun: boolean,
    insertMode: boolean,
) {
    if (dryRun) return;
    if (insertMode) {
        await collection.insertMany(docs, { ordered: false });
        return;
    }
    const ops = docs.map((doc) => ({
        replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
        },
    }));
    await collection.bulkWrite(ops, { ordered: false });
}

async function ensureIndexes(db: Db, table: string) {
    const fields = [...(INDEX_MAP[table] || [])];
    if (MESSAGE_TABLES.has(table)) fields.push(['eventId']);
    for (const keys of fields) {
        const index: Record<string, 1> = {};
        for (const key of keys) index[key] = 1;
        const options =
            keys.length === 1 && keys[0] === 'eventId'
                ? { name: 'idx_eventId', unique: true, sparse: true }
                : { name: `idx_${keys.join('_')}` };
        await db.collection(table).createIndex(index, options);
    }
}

async function migrateTable(
    conn: PoolConnection,
    db: Db,
    database: string,
    table: string,
    opts: MigrateOptions,
): Promise<{ total: number; written: number }> {
    if (opts.drop) {
        await db
            .collection(table)
            .drop()
            .catch(() => {});
    }
    const primary = await primaryKeys(conn, database, table);
    const collection = db.collection(table);
    // 集合为空（含 --drop 后）直接 insertMany，避免 upsert 逐条查 _id
    const insertMode = !(await collection.findOne({}));
    const timeColumn = TIME_COLUMNS[table];
    const orderBy = timeColumn ? ` ORDER BY \`${timeColumn}\` ASC` : '';
    const where = opts.where ? ` WHERE ${opts.where}` : '';
    const countRows = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\`${where}`);
    const tableTotal = Number(countRows[0]?.n || 0);
    const displayTotal = opts.limit > 0 ? Math.min(opts.limit, tableTotal) : tableTotal;
    const sql =
        opts.limit > 0
            ? `SELECT * FROM \`${table}\`${where}${orderBy} LIMIT ${opts.limit}`
            : `SELECT * FROM \`${table}\`${where}${orderBy}`;
    const stream = conn.queryStream(sql);

    let buffer: Record<string, any>[] = [];
    let total = 0;
    let written = 0;
    const start = Date.now();
    let lastReport = 0;
    console.log(
        `[${database}] ${table}: 总数 ${tableTotal}，开始迁移（${insertMode ? 'insertMany' : 'upsert'}）`,
    );
    for await (const row of stream) {
        buffer.push(buildDoc(table, row as Record<string, any>, primary));
        total++;
        if (buffer.length >= opts.batch) {
            await writeBatch(collection, buffer, opts.dryRun, insertMode);
            written += buffer.length;
            buffer = [];
            const now = Date.now();
            if (now - lastReport >= 1000) {
                process.stdout.write(
                    `\r${progressLine(database, table, total, displayTotal, start)}`,
                );
                lastReport = now;
            }
        }
        if (opts.limit > 0 && total >= opts.limit) break;
    }
    if (buffer.length) {
        await writeBatch(collection, buffer, opts.dryRun, insertMode);
        written += buffer.length;
    }

    if (!opts.dryRun) await ensureIndexes(db, table);
    process.stdout.write(`\r${progressLine(database, table, total, displayTotal, start)}\n`);
    return { total, written };
}

async function migrateBot(bot: string, opts: MigrateOptions) {
    const botMongo = config.bots[bot].mongo;
    if (!botMongo) {
        console.warn(`[${bot}] 未配置 mongo，跳过`);
        return;
    }

    const pool = createPool({ ...config.mariadb, database: bot, connectionLimit: 2 });
    const conn = await pool.getConnection();
    const mongoClient = new MongoClient(botMongoUri(bot), {
        serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS || 5000,
    });
    await mongoClient.connect();
    const db = mongoClient.db(botMongo.database);

    const tables = opts.tables.length ? opts.tables : KNOWN_TABLES;
    try {
        for (const table of tables) {
            if (!(await tableExists(conn, bot, table))) {
                console.warn(`[${bot}] 表不存在，跳过: ${table}`);
                continue;
            }
            const { total, written } = await migrateTable(conn, db, bot, table, opts);
            console.log(
                `[${bot}] ${table}: total=${total} written=${written}${opts.dryRun ? ' (dry-run)' : ''}`,
            );
        }
    } finally {
        conn.release();
        await mongoClient.close();
        await pool.end();
    }
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const bots = opts.bots.length
        ? opts.bots
        : Object.keys(config.bots).filter((b) => config.bots[b].allowMongo);

    if (opts.drop) {
        console.warn('注意: --drop 会删除目标 MongoDB collection，请确认数据可恢复！');
    }
    if (opts.dryRun) console.log('dry-run 模式：只统计，不写入');

    for (const bot of bots) {
        await migrateBot(bot, opts);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
