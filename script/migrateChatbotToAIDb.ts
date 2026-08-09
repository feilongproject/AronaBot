/**
 * 把旧 PlanaBot 库中的 AI 聊天集合迁移到 AI 专用库（默认 PlanaBotChat）。
 * 幂等：按 _id upsert，可重复执行；不会删除旧库数据。
 *
 * 用法：pnpm exec tsx -r dotenv/config script/migrateChatbotToAIDb.ts
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

const ROOT = process.cwd();
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/settings.json'), 'utf-8'));
const aiConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/ai.json'), 'utf-8'));

const CHAT_COLLECTIONS = [
    'chatContext',
    'chatMemory',
    'chatSessionMeta',
    'chatSticker',
    'chatNoop',
] as const;

function mongoUri(cfg: { user: string; password: string; database: string; authSource?: string }) {
    const authSource = cfg.authSource || cfg.database;
    return `mongodb://${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.password)}@${
        settings.mongo.host
    }:${settings.mongo.port}/${cfg.database}?authSource=${encodeURIComponent(authSource)}`;
}

async function main() {
    const botMongo = settings.bots.PlanaBot.mongo;
    const aiMongo = aiConfig.bots?.PlanaBot?.mongo;
    if (!botMongo || !aiMongo) {
        console.error('缺少 PlanaBot 主库或 ai.json bots.PlanaBot.mongo 配置');
        process.exit(1);
    }

    const oldClient = new MongoClient(mongoUri(botMongo), { serverSelectionTimeoutMS: 5000 });
    const newClient = new MongoClient(mongoUri(aiMongo), { serverSelectionTimeoutMS: 5000 });
    await Promise.all([oldClient.connect(), newClient.connect()]);

    const oldDb = oldClient.db(botMongo.database);
    const newDb = newClient.db(aiMongo.database);
    const existing = new Set((await oldDb.listCollections().toArray()).map((c) => c.name));

    for (const name of CHAT_COLLECTIONS) {
        if (!existing.has(name)) {
            console.log(`- ${name}: 旧库不存在，跳过`);
            continue;
        }
        const col = oldDb.collection(name);
        const total = await col.countDocuments();
        console.log(`- ${name}: 旧库 ${total} 条，开始迁移`);
        let moved = 0;
        const cursor = col.find({});
        let batch: any[] = [];
        for await (const doc of cursor) {
            batch.push({
                replaceOne: {
                    filter: { _id: doc._id },
                    replacement: doc,
                    upsert: true,
                },
            });
            if (batch.length >= 500) {
                await newDb.collection(name).bulkWrite(batch);
                moved += batch.length;
                batch = [];
            }
        }
        if (batch.length) {
            await newDb.collection(name).bulkWrite(batch);
            moved += batch.length;
        }
        console.log(`- ${name}: 迁移完成 ${moved}/${total}`);
    }

    await Promise.all([oldClient.close(), newClient.close()]);
    console.log(`AI 数据已迁移到 ${aiMongo.database} 库（${aiMongo.user}）`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
