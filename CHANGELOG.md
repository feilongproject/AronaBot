# Changelog

## 2026-08-06

### 数据库迁移：MariaDB → MongoDB

- 使用 `docker-compose` 搭建 MongoDB 8.0 + Mongo Express 并组成独立子网
  （`/var/lib/mongodb-files`，端口映射 27017 / 18081），数据库文件持久化到本地。
- 创建 `AronaBot` / `PlanaBot` 数据库及各自只读写的专用账号，认证库为对应库名；
  允许内网 `10.0.0.0/24` 访问。
- `config/settings.json` 新增 `mongo` 顶层连接配置与各 bot 的 `allowMongo` / `mongo`
  专用账号配置。

### 运行时双写（收到消息即入库）

- `init.ts` 初始化 MongoDB 连接，全局暴露 `mongo`（客户端）与 `mongoDb`（Db 句柄）。
- `eventRec.ts` 在收到消息时通过 `writeMessageDB` 整对象写入：
  - 频道 / 私信 / 群 / C2C 消息 → `guildMessage` / `directMessage` /
    `groupMessage` / `c2cMessage`，`_id` 取 `eventId`；
  - 命令执行记录 → `executeRecord`，结构为
    `eventId/mid/type/optFather/optChild/guild_id/channel_id/channel_name/author/timestamp`；
  - 成员 / 表情表态事件 → `GUILD_MEMBERS` / `GUILD_MESSAGE_REACTIONS`，写入原始事件对象。
- `common.ts` 的 `pushToDB` 改为写入 MongoDB：`_id` 按
  `eventId > mid > id > eId > msgId` 选择，`replaceOne` + `upsert` 幂等写入；
  `timestamp` / `ts` 字段统一转为 Date，保证新旧数据格式一致。

### 迁移脚本

- 新增 `script/migrateMariadbToMongo.ts`（`pnpm migrate:mongo`）：
  - 流式分批迁移，支持 `--bot` / `--table` / `--dry-run` / `--drop` / `--batch` / `--limit`；
  - 按各表时间字段升序读取（旧 → 新），实时显示进度、速率与耗时；
  - 消息表结构对齐实时写入：`aid/aName/aAvatar → author{id,username,avatar}`、
    `mid → id`、`gid → guild_id/group_id`、`cid → channel_id`、
    `ts → timestamp`、`attachments/mentions/roles` 解析为数组；
  - executeRecord 对齐为 `guild_id/channel_id/channel_name/author/timestamp`；
  - GUILD_MEMBERS 对齐为 `eventId/guild_id/joined_at/roles[]/user{...}`；
  - GUILD_MESSAGE_REACTIONS 对齐为 `channel_id/emoji{}/guild_id/target{}/user_id`；
  - 索引显式命名（`idx_author.id`、`idx_eventId` 等），消息表保留 `idx_eventId`
    唯一稀疏索引，移除与 `_id` 重复的 `id/mid` 索引。
  - `ts` 为零日期（`0000-00-00 00:00:00`）时统一写成 1970-01-01T00:00:00Z，
    避免 Mongo Express 显示为 null。
  - executeRecord 只保留 `_id`（=消息 id），不再冗余存储 `eventId` / `mid`。
  - 迁移加速：默认 batch 提升到 5000；空集合自动使用 `insertMany`（避免
    upsert 逐条查 `_id`），非空集合回退 upsert；新增 `--where <sql>` 支持按
    时间范围分片多进程并行迁移。

### 移除 MariaDB 运行时依赖

- 删除 `init.ts` 的 MariaDB 连接与 `global.mariadb`；
- 删除 `common.ts` 的 `searchDB`；
- `wifu.ts` / `admin.ts` 的原 MariaDB 查询改写为 MongoDB 查询；
- 配置移除 `allowMariadb`；`mariadb` 连接配置仅保留给迁移脚本读取旧数据使用。

### 每日备份

- `/var/lib/mongodb-files/backup.sh`：通过 cron 每天 03:00 执行 `mongodump
  --archive --gzip` 备份全部 MongoDB 数据库到 `backups/`，保留最近 14 天；
  备份成功后由 `backup-upload.js` 上传到 COS `backup/<日期>/` 目录
  （`backup.log` + `mongodb_*.archive.gz`），已实测生成约 945MB 归档并上传成功。
