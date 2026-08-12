/**
 * 用本地 classifyStickerTags 给 chatSticker 补全
 * sceneTags / contentTags / subjectTags（不调 vision）。
 *
 * 用法：pnpm exec tsx -r dotenv/config script/backfillStickerTagBuckets.ts
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

// models 依赖全局 log
(global as any).log = {
    debug: () => {},
    info: (...a: unknown[]) => console.log('[INFO]', ...a),
    warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
    error: (...a: unknown[]) => console.error('[ERROR]', ...a),
    mark: () => {},
    trace: () => {},
};
(global as any).devEnv = false;

async function main() {
    const { classifyStickerTags } = await import('../src/plugins/chatbot/models');
    const ROOT = process.cwd();
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/settings.json'), 'utf-8'));
    const ai = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/ai.json'), 'utf-8'));
    const m = ai.mongo;
    if (!m) throw new Error('ai.json 缺少 mongo');

    const uri = `mongodb://${encodeURIComponent(m.user)}:${encodeURIComponent(m.password)}@${
        settings.mongo.host
    }:${settings.mongo.port}/${m.database}?authSource=${encodeURIComponent(
        m.authSource || m.database,
    )}`;
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const col = client.db(m.database).collection('chatSticker');
    const docs = await col.find({}).toArray();
    console.log(`backfill ${docs.length} stickers…`);

    let n = 0;
    for (const d of docs) {
        const c = classifyStickerTags({
            tags: d.tags || [],
            emotionTags: d.emotionTags || [],
            styleTags: d.styleTags || [],
            sceneTags: d.sceneTags || [],
            contentTags: d.contentTags || [],
            subjectTags: d.subjectTags || [],
        });
        await col.updateOne(
            { _id: d._id },
            {
                $set: {
                    tags: c.tags,
                    emotionTags: c.emotionTags,
                    styleTags: c.styleTags,
                    sceneTags: c.sceneTags,
                    contentTags: c.contentTags,
                    subjectTags: c.subjectTags,
                    tagsClassifiedAt: new Date(),
                },
            },
        );
        n++;
    }

    const [withScene, withContent, withSubject] = await Promise.all([
        col.countDocuments({ sceneTags: { $exists: true, $not: { $size: 0 } } }),
        col.countDocuments({ contentTags: { $exists: true, $not: { $size: 0 } } }),
        col.countDocuments({ subjectTags: { $exists: true, $not: { $size: 0 } } }),
    ]);
    const sample = await col.findOne({ emotionTags: '委屈' });
    console.log({
        updated: n,
        withScene,
        withContent,
        withSubject,
        sample: sample && {
            emotion: sample.emotionTags,
            style: sample.styleTags,
            scene: sample.sceneTags,
            content: sample.contentTags,
            subject: sample.subjectTags,
        },
    });
    await client.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
