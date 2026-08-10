# PlanaBot 群聊被动 AI 闲聊 — 需求与设计总结

> 状态：P0/P1/P2 已实现；P3 中 **MCP 接入、H2 门控（Qwen3Guard-Stream-0.6B /moderate）、设置页图库管理（列表/搜索/隐藏/恢复/拒绝/删除/编辑摘要、pending 人工审核）已实现**，剩余 Top-K LLM 精排、斗图窗口  
> 日期：2026-08-08（修订：vision=`qwen3.7-plus`、群聊表情自动抓取与语义回图）  
> 决议 v2（2026-08-08）：统一 `group_openid`；删除 aiAllow 硬编码与旧 `^chat` 路由；`isOffical` 废除；bot 出站消息入库；回复判定缓存 Redis 3h；限流 1/s、10/min；图库发送必入 Mongo；dpsk 压缩 / qwen 看图 / vision 独立密钥；动图按图片发送；多图批量分析；nsfw 性格化拒答  
> 决议 v6（2026-08-10）：**图库人工审核**：默认 `status=pending`，设置页通过后才 `ready` 可被选图；可编辑 `summary`/`tags`；`stickerAutoApprove=true` 可恢复旧行为；手机端图库单行展示  

> 决议 v3（2026-08-08）：bot 出站统一在发送层入库（与重试逻辑对应）；非关键数值参照其余 bot 实现；默认猫娘 prompt 参照主流 chatbot；MCP 后续配置留出空间  
> 决议 v4（2026-08-08）：风控自部署 `Qwen3Guard-Stream-0.6B`；去重统一按消息 id（msgId），不做 content hash 严格去重；存量仅清理 opts，其余暂不改并打 `@deprecated` 标记  
> 决议 v5（2026-08-08）：H2 门控对接自部署 `Qwen3Guard-Stream-0.6B` FastAPI `/moderate`（`baseURL` 默认 `http://127.0.0.1:8000`、已启用）；**只判定本次用户消息**（不携带历史/元信息，截断 600 字防超时）；**Must 默认不过门控**，`gate.applyToMust=true` 时必过（拦截从 `refusalMessages` 台词池随机短提示、故障放行）；`noop` 记录含当前上下文与用户信息；**上下文保留用户 @ 为 `<@openid>`**，回复支持 `mention` part（仅允许本轮出现过的 openid），`adminOpenid` 标记最高管理员；**回复一律走 `sendMarkdown`**（@ 渲染用 `<qqbot-at-user id="openid" />` 协议，图库表情用 markdown 图片），并输出 `chatbot 回复原始正文` / `chatbot 发送 markdown` 调试日志；去重实现选最合适策略；`@deprecated` 仅加注释  
> 范围：P0（准入/观察库/触发/限流/dpsk 文本）、P1（双条件压缩）、P2（qwen 看图/表情库/语义发图）已落地；
> P3 剩余：Top-K LLM 精排、斗图窗口（MCP 接入、H2 自部署门控、设置页图库管理已完成）。
> 相关现状：`src/plugins/chatbot.ts`（整文件已注释）、`src/eventRec.ts` → `aiAllow`、`config.bots.*.chatbot`

---

## 1. 目标

在**未匹配任何指令**时，让 **PlanaBot** 在白名单群内以「猫娘群友」身份参与闲聊，并具备：

| 能力       | 说明                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| 读消息     | 观察群聊（含图），写入**群公共**上下文；**含未回复观察消息**            |
| 选择不回复 | 静默合法；@ / 先导词强制回；普通 hybrid；**接话动态概率**               |
| 分析图片   | 收 `attachments`；**阿里云 `qwen3.7-plus`** 多模态理解/转述             |
| 表情库     | **自动抓取群聊图片/表情包** → 摘要+标签入库 → 后续语义匹配发送          |
| 发送图片   | 文字 / 图 / 图文；`IMessage*` + COS / `file_info`；从图库按摘要选合适图 |
| 工具扩展   | **可接入部分 MCP**（白名单工具，受安全约束）                            |

---

## 2. 已冻结需求（完整版）

| 项           | 决议                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 场景         | **仅群聊**；**仅白名单群**                                                                                                                                                         |
| 群 id        | **统一使用 `group_openid`**；`group_id` / `groupMap` 即将废除，新代码不再依赖                                                                                                      |
| 全量接收     | 白名单群**均需配置全量接收**；`enableFullReceiveGroups` 以 **openid** 为准（此前数字群号为错误配置，已改正）；实现期做启动校验告警，不再作为「能力降级」主路径                     |
| 消息合法性   | **`isOffical` 废除**；不再作为准入/过滤/落库条件                                                                                                                                   |
| 启停         | **全局 `ai.activeBot` 指定唯一宿主** + 顶层唯一一份 `ai.chatbot`（设置页切换宿主、编辑同一份参数）                                                                                 |
| 触发 · Must  | **@ 本 bot** 或 **先导词** → **必须回复**；**忽略抽卡**（不掷骰、不累加、不重置累计）                                                                                              |
| 先导词格式   | **`xxx[空格]`** 前缀：去 @ 后 `trim`，以 `先导词 + 至少一个空格` 开头才命中；`xxx` 为 `mustPrefixes`；示例：`星奈 今天天气怎么样`                                                  |
| 触发 · Maybe | **抽卡累计**：初始 `replyProbability`（默认 0.0005），未中每条 `+replyProbabilityStep`（默认 0.0001），真正发出后重置；Must 不参与                                                 |
| 决策         | **hybrid**；H2 风控采用**自部署 `Qwen3Guard-Stream-0.6B`**（最后配置，**Must 不使用门控**），输出 `noop` 必须记录（含上下文与用户信息）；AI 逻辑参照 **MumuBot / Muice / AstrBot** |
| 限流         | **每秒 1 条 / 每分钟 10 条**（提供配置项）                                                                                                                                         |
| 上下文       | **群公共历史**；含未回复观察消息；**bot 其余 @ 消息与回复也入库**                                                                                                                  |
| 记忆压缩     | 旧历史由 **dpsk** 压缩进 Mongo；**双条件触发**（条数 **或** token 预算）                                                                                                           |
| 上下文容量   | 硬顶 `maxContextTokens`（1M）；日常用 `workingContextTokens`；token 估算优先 API 返回 usage，缺失时本地 tokenizer                                                                  |
| 模型 · 文本  | **DeepSeek（dpsk）**                                                                                                                                                               |
| 模型 · 图片  | **阿里云百炼 `qwen3.7-plus`**（OpenAI 兼容接口）；**独立 `visionApiKey`**；多图**批量分析**（请求形态按官方文档）；摘要后再交 dpsk 做人设回复                                      |
| 发图 / 图库  | **自动抓取群聊表情包/图片** → `qwen3.7-plus` **总结 + 标签** 入库（**默认 pending 人工审核**，可编辑摘要）→ 通过后按语境选图发送；**动图按图片发送**                                                          |
| 人设         | **猫娘风格**；文案可后续微调；**设置页可改**（`systemPrompt` 等热替换）                                                                                                            |
| 内容安全     | 图片 `nsfw` 命中时按人设给出**性格化的拒绝回复**                                                                                                                                   |
| MCP          | **可接入部分 MCP**（配置白名单 tools；禁止危险工具默认开启）                                                                                                                       |
| 输出         | 可发文字、可发图片；**所有发送必须记录到 MongoDB**                                                                                                                                 |
| 超长文本     | **忽略模型调用**，Mongo 仍写入并标 **`ignored: true`**（+ `ignoreReason`）                                                                                                         |
| 存储         | **仅 MongoDB** 存互动上下文；**禁止** `memoryDir` 作记忆                                                                                                                           |

原则（对齐 `AGENTS.md`）：

- **指令优先**；chatbot 仅作 `findOpts` 失败后的兜底。
- 插件不自注册；`opts.path=chatbot` / `opts.fnc=chatbot`。
- 发送统一走 `msg.sendMsgEx` / `sendMarkdown`。

---

## 3. 仓库现状与缺口

### 3.1 已有可复用能力

1. **群侧兜底**（`eventRec.executeChat` → `aiAllow`）— 群列表硬编码需删除，改读 `chatbot.groups`，仅 PlanaBot，按 `group_openid` 匹配。
2. **配置骨架** — `groups` / `replyProbability` / 历史与压缩字段已有；需扩展动态概率、先导词、人设、vision、MCP、限流；`memoryDir` 废弃作记忆。
3. **全量群消息** — 已接；`enableFullReceiveGroups` 已改正为 openid；实现期做启动校验告警。
4. **收图 / 发图** — `attachments` 下载；`msgType:7` + `file_info`；COS。
5. **OpenAI 兼容** — `translate.ts`（DashScope）；旧 chatbot DeepSeek。
6. **Mongo** — PlanaBot `allowMongo`；`pushToDB` / `mongoDb.collection`。
7. **设置页热替换** — 保存 `settings.json` 后进程内 config 热更新（路径/API 类立即生效类能力已有先例）。

### 3.2 主要缺口

| 点                  | 说明                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `chatbot.ts`        | 整文件注释；MariaDB + `^chat` 指令式；**旧 `^chat` 路由删除**，仅保留纯兜底                                                                    |
| 群 id / isOffical   | 统一 `group_openid`；`group_id` / `groupMap` 不再依赖；`isOffical` 废除；**存量代码暂不改动，相关字段/逻辑仅加 `@deprecated` 注释**            |
| 观察写库            | 兜底进插件后 **先写观察再决策**；**bot 出站统一在发送层入库**（需与 `callWithRetry` 重试逻辑对应，避免重复/错记）                              |
| 去重                | **统一按消息 id（msgId）** 唯一稀疏索引；不按 eventId / content hash 严格去重                           |
| 存量清理范围        | **仅清理 `config/opts.ts`**（删 `^chat`）；eventRec / IMessageEx / schema 等暂时保持不变，**仅在相关位置加 `@deprecated` 注释**，不改结构/行为 |
| 动态接话概率        | 需检测「回复 bot」；**出站 msgId 近 3 小时全量缓存 Redis**                                                                                     |
| 先导词 `xxx + 空格` | 需规范化匹配与剥离                                                                                                                             |
| Vision / 图库       | 已实现：`qwen3.7-plus` + **自动偷图入库（默认 pending 审核）** + 语义选图 + 设置页编辑摘要                                                                          |
| noop / 风控         | H2 门控**最后配置**（自部署 `Qwen3Guard-Stream-0.6B`，**Must 不过门控**）；`noop` 必须记录（含上下文与用户信息）                               |
| MCP                 | 已接入 `@modelcontextprotocol/sdk` 客户端（stdio/http/sse），dpsk function calling 循环执行                                                                |
| 人设设置页字段      | schema 需增加 `systemPrompt` 等                                                                                                                |

---

## 4. 总体架构

```
消息入站
  → IMessageGROUP + findOpts（指令优先）
  → executeChat
       ├─ 命中指令 → 原插件
       └─ 未命中 + PlanaBot + 白名单
            → aiAllow 挂 chatbot
                 │
                 ▼
            [1] 准入（PlanaBot / 白名单 group_openid）/ ban
            [2] 清洗；超长 → ignored 落库，不调模型
            [3] 写 Mongo 观察行（含未回复；公共历史）
            [4] 判定 Must / 动态 Maybe / Never
            [5] 本条有图：qwen3.7-plus 转述 → visionSummary（对话用）
            [5b] 异步/同步：表情抓取管道 → 摘要+标签 → chatSticker 入库（去重；默认 pending 待审）
            [6] 装上下文（system 猫娘+安全 + memory 块 + 近期 raw 含 observe）
            [7] dpsk（± MCP / 选图 tool）→ 结构化动作（text / image_from_library）
            [8] 发送（限流 1/s、10/min）；从图库按 summary/tags 匹配发图；回写 assistant；发送记录必入 Mongo
            [9] 双条件检查 → 压缩任务
            [10] H2 风控门控（最后配置；Must 跳过）→ noop 记录（含上下文/用户）
```

**逻辑参照映射**：

| 参考项目                | 采纳点                                                          |
| ----------------------- | --------------------------------------------------------------- |
| **Muice**               | @ 必回 + 非 @ 随机回；群聊「像人」                              |
| **AstrBot**             | `possibility_reply≈0.1`；上下文阈值压缩；群记录注入；图转述     |
| **MumuBot**             | 自主沉默/接话；记忆分层；vision 独立；表情包收集与决策发送；MCP |
| **smart_imagechat_hub** | **自动偷图 → 摘要/标签入库（无审核）→ 语义选图 → 主动发表情**   |

---

## 5. 触发与动态概率

### 5.1 准入

1. `botType === 'PlanaBot'`
2. `IMessageGROUP`
3. `group_openid ∈ chatbot.groups`
4. `findOpts` 未命中
5. 未 ban
6. `chatbot.enabled === true`（建议）
7. `isOffical` **废除**，不再校验

**全量**：白名单已全量接收 → 普通闲聊与观察消息均可稳定入站。`enableFullReceiveGroups` 以 **openid** 为准；启动校验：若 `chatbot.groups` 存在未全量接收项，打 `log.warn`，不静默改行为。

### 5.2 MustReply

| 条件     | 匹配细节                                                                   |
| -------- | -------------------------------------------------------------------------- |
| @ 本 bot | `mentions.is_you`（全场景可用）                                            |
| 先导词   | 去 `@` 后 `trim`，满足 **`^${prefix}\s+`**（**prefix 后必须有空格/空白**） |

示例（`mustPrefixes: ["星奈", "plana"]`）：

| 正文              | 结果                                |
| ----------------- | ----------------------------------- |
| `星奈 你好`       | Must；送入模型正文 = `你好`         |
| `星奈你好`        | **不**命中先导词（无空格）          |
| `  plana  吃了吗` | Must（trim 后仍 `prefix + \s+`）    |
| 仅 `星奈` 无后续  | 不命中先导词格式；若无 @ 则走 Maybe |

Must：**跳过概率**；**Must 触发不使用 H2 门控**（见 5.4）；注入/违规仍可拒答或短拒。

### 5.3 动态概率（Maybe）

```
effectiveP =
  if isReplyToBot(msg):  replyToBotProbability   // 冻结 = 0.7
  else:                  replyProbability        // 冻结 = 0.1
```

**`isReplyToBot` 判定（按可用性优先级）：**

1. 引用/回复消息：`message_scene.ext` 中 `ref_msg_idx` 关联 **bot 出站 msgId**；**出站 msgId 近 3 小时全部缓存 Redis**（TTL=3h，按群/消息 id 索引），Redis 为判定主路径。
2. 若平台提供 reply 字段，直接用。
3. 弱启发式（可选，默认关）：短窗口内（如 120s）且内容明显接话 —— 易误伤，不作为主路径。

**状态**：`chatSessionMeta` 或 Redis 记：

- `lastBotReplyAt`、`lastBotMsgIds[]`（**近 3 小时全部出站 id**，Redis）
- 接话成功后可刷新窗口，形成「短连环对话」；可用 `replyChainMax` / 时间窗防止无限 0.7 续聊。

### 5.4 Hybrid 流水线

| 阶段                        | 内容                                               |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| H0 规则                     | 空/噪声/ignored/限流/CD → Never                    |
| H1 动态概率                 | 0.1 或 0.7 抽样                                    |
| H2 风控门控（**最后配置**） | 自部署 **`Qwen3Guard-Stream-0.6B`**；短 JSON `noop | reply`；**Must 触发不经过门控**；每次返回 `noop` 必须记录（Mongo） |

`noop`：彻底静默；无论 H2 是否启用，产生 `noop` 均需落库记录，**记录含当前上下文快照与用户信息**（groupOpenid、authorId、trigger、本轮输入、近期 history 等）。

### 5.5 建议限流

| 参数                    | 冻结默认                                    |
| ----------------------- | ------------------------------------------- |
| `replyProbability`      | **0.1**                                     |
| `replyToBotProbability` | **0.7**                                     |
| `rateLimitPerSecond`    | **1**（可配置）                             |
| `rateLimitPerMinute`    | **10**（可配置）                            |
| `replyChainWindowSec`   | 120～300（非关键数值参照其余 bot 实现取值） |
| 用户/群 CD              | 防刷；Must 可放宽但仍受 1/s、10/min 硬顶    |

---

## 6. Mongo 数据模型

Redis：限流 / 锁 / 短 CD / **bot 出站 msgId 缓存（近 3 小时全量，TTL=3h）**。  
**正文与摘要：仅 Mongo**（已落地为 AI 专用库 `PlanaBotChat`，账号同名；
连接在 `config/ai.json` → `bots.PlanaBot.mongo`；未配置时回落 bot 主库）。

### 6.1 `chatContext`（群公共时间线，含观察）

```ts
{
  _id: string,
  botType: 'PlanaBot',
  groupOpenid: string,           // group_openid
  role: 'user' | 'assistant' | 'system_note',
  authorId?: string,
  msgId?: string,
  eventId?: string,
  content: string,
  contentHash?: string,          // 审计字段（不再作为去重键；去重按 msgId）
  rawContent?: string,
  images?: {
    url: string,
    cosKey?: string,
    visionSummary?: string,
    tags?: string[],          // smart_imagechat 风格标签，可选
    w?: number, h?: number,
  }[],
  trigger: 'must_at' | 'must_prefix' | 'hybrid' | 'hybrid_reply_chain' | 'observe',
  replied: boolean,           // 本条 user 是否触发了 bot 回复
  ignored?: boolean,          // 超长等：true 时不进模型
  ignoreReason?: string,      // e.g. 'max_user_chars'
  archived?: boolean,
  refMsgId?: string,          // 若为回复某条
  ts: Date,
}
```

**写入规则**：

- 过准入的消息 **一律先 insert**（观察）。
- 超长：`ignored: true`，`replied: false`，**不调 LLM**。
- ignored 文档 **默认不进入** 模型 history 装配（审计保留）；或仅以占位 `[已忽略过长消息]` 一条 system_note（二选一，建议 **不装配原文**）。
- 未回复观察：`trigger: 'observe'`，`replied: false`，**正常进入公共历史装配**（未 ignored 时）。
- **命中其他指令的用户消息也写入**（`trigger: 'command'`，`replied: true`）：白名单群内 bot 的其它指令调用同样进入公共历史。
- **bot 其余 @ 消息与回复也写入**（`role: 'assistant'`），使公共历史包含 bot 全部发言；发送记录强制 Mongo，**统一在发送层记录**（须与 `callWithRetry` 重试逻辑对应：以最终成功发送为准，重试不重复写入）。
- **去重按消息 id（msgId）**：user/assistant 行均以 `msgId` 为唯一键（`{ msgId: 1 }` unique sparse）；
  出站记录在发送成功后以 bot 消息 id 落库，重试成功仅写一次；不按 eventId / content hash 严格去重。
- **noop 记录**：H2 产生 `noop` 时写 Mongo（`chatContext` system_note 或独立集合），必含 groupOpenid、authorId、trigger、**当前上下文快照**、本轮输入、ts。

索引：`{ groupOpenid: 1, ts: -1 }`；`{ msgId: 1 }` unique sparse（统一按消息 id 去重）。

### 6.2 `chatMemory`

压缩摘要块（同前）：`groupOpenid + seq + summary + coverFrom/To + tokenEstimate`。

### 6.3 `chatSessionMeta`

```ts
{
  _id: string,                 // groupOpenid
  lastCompressAt?: Date,
  lastReplyAt?: Date,
  lastBotMsgIds?: string[],    // 近 3h Redis 缓存（发送时写入）
  recentTokenEstimate: number,
  version: number,
}
```

### 6.4 压缩 — **双条件触发**

满足 **任一** 即触发压缩任务（加群锁）：

| 条件     | 配置项（示例）                                             | 含义                                                                                                       |
| -------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A. 条数  | `compressInterval`                                         | 自上次压缩以来，新增未归档 raw **≥ N 条**                                                                  |
| B. Token | `compressTokenThreshold` 或 `workingContextTokens * ratio` | 未归档 raw 估算 token **≥ 阈值**（如 working 的 70%～82%，对齐 AstrBot 量级；非关键数值参照其余 bot 实现） |

压缩后：写 `chatMemory`（**摘要由 dpsk 生成**）；源 raw `archived: true`；修剪块数 ≤ `maxSummaryBlocks`。

### 6.5 上下文装配

```
[system: 猫娘人设(可设置页改) + 安全协议 + 输出/MCP 说明]
[memory: 最近 K 块 summary]
[history: 近期未归档 raw —— 含 observe 与 assistant；排除 ignored 原文]
[user: 本轮（已剥先导词/@；可附 visionSummary）]
```

硬顶 `maxContextTokens = 1e6`；日常 `workingContextTokens` ≪ 1M。

**token 估算**：优先使用模型返回结果中携带的参数（API usage），缺失时使用本地 tokenizer。

---

## 7. 人设（猫娘）与设置页

### 7.1 默认风格

- 猫娘口吻（语气词、亲昵、轻微傲娇/粘人等，可后续微调）。
- **安全条优先级 > 人设**（防注入、拒违法）。
- 默认 `systemPrompt` **参照主流 chatbot（Muice / MumuBot 等）的猫娘/人设写法**内置一版；运营可在设置页覆盖。

### 7.2 设置页可改字段（建议 schema）

已落地为独立 AI 配置文件 `config/ai.json`（`ai.schema.json` 说明；`aiTranslate` 除外仍留
`settings.json`）。运行时仍以 `config.bots.PlanaBot.chatbot` 读取（启动时由 ai.json 合并）。
在 `bots.PlanaBot.chatbot` 下暴露（description 写清）：

- `enabled`、`groups`
- `systemPrompt`（多行文本）
- `mustPrefixes`（数组）
- `replyProbability`（抽卡初始，默认 0.0005）、`replyProbabilityStep`（未中累加，默认 0.0001）；`replyToBotProbability` 已弃用
- `rateLimitPerSecond`（默认 1）、`rateLimitPerMinute`（默认 10）
- `maxUserChars`、`workingContextTokens`、`maxContextTokens`
- `compressInterval`、`compressTokenThreshold`、`maxSummaryBlocks`
- `chatModel`、`baseURL`（可选）、依赖 `dsKey`
- `visionModel`（默认 **`qwen3.7-plus`**）、`visionBaseURL`、**独立 `visionApiKey`**
- 表情抓取：`stickerCaptureEnabled`、`stickerCaptureMode`、`stickerAutoApprove`（默认 false）、库上限等
- `stickerReplyProbability`
- MCP：`mcpServers` / `mcpEnabledTools`（一期仅配置空间，server 后续接入）
- H2 风控：`gateEnabled`（已启用）/ `gateModel`（默认 `Qwen3Guard-Stream-0.6B`）/ `gateBaseURL`（默认 `http://127.0.0.1:8000`，POST `/moderate`，**只判定本次用户消息**，截断 600 字：`Safe`→回复，`Controversial`/`Unsafe`→noop）/ `gateApplyToMust`（默认 false；true 时 Must 也过门控，拦截从 `refusalMessages` 随机短提示、故障放行；非 Must 故障仍 fail-closed 静默）

保存后走现有 **config 热替换**；改 `systemPrompt` **无需重启**即可影响下一轮对话。

---

## 8. 模型

### 8.1 文本：DeepSeek

- OpenAI 兼容 SDK，`chatModel` 配置化。
- Key：`bots.PlanaBot.dsKey`。
- 结构化输出：`action` + `parts`（text / sticker / tool…）。
- **压缩任务使用 dpsk 生成 `chatMemory` 摘要**。
- **token 估算**：优先 API 返回 usage，缺失时本地 tokenizer。

### 8.2 Vision：阿里云 `qwen3.7-plus`（已冻结）

| 项      | 规格                                                                               |
| ------- | ---------------------------------------------------------------------------------- |
| 提供商  | **阿里云百炼 / DashScope**                                                         |
| 模型 ID | **`qwen3.7-plus`**（配置项 `visionModel`，默认真值即此）                           |
| 接口    | OpenAI 兼容 `chat.completions`（`compatible-mode/v1`）                             |
| 能力    | 多模态：图像理解、OCR、情绪/梗意描述；供对话转述 **与** 表情库打标                 |
| Key     | **独立 `visionApiKey`**（设置页可改）；与 `dsKey` / `aiTranslate.apiKey` 均分离    |
| baseURL | 默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`（以现网文档为准，可配置） |

请求形态：

```ts
// visionModel = 'qwen3.7-plus'
messages: [
    {
        role: 'user',
        content: [
            {
                type: 'text',
                text: [
                    '用简洁中文输出：',
                    '1) summary: 一句话内容概要（供检索与回复）',
                    '2) tags: 3～8 个短标签（情绪/角色/梗/OCR关键词）',
                    '3) nsfw_risk: low|mid|high',
                    '尽量 JSON。',
                ].join('\n'),
            },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } },
        ],
    },
];
```

**多图**：支持**同一请求内批量分析**多张图片，具体请求字段/上限以阿里云官方文档为准。

**双用途同一模型：**

1. **对话转述**：当前消息附图 → `visionSummary` 写入 `chatContext`，再交给 dpsk 猫娘回复。
2. **入库打标**：自动抓取的表情/图 → `summary + tags` 写入 `chatSticker`，供后续选图。

**Pipeline：**

```
attachments 下载 → 体积/类型门禁 → 可选 sharp 缩边
  → qwen3.7-plus
  → { summary, tags, nsfw_risk }
  → (对话) dpsk 只吃 summary 文本
  → (图库) 去重后 COS + Mongo chatSticker
```

无 vision 密钥时：Must 可短提示「还看不了图」；Maybe 有图可降权；**偷图打标暂停**（仅缓存 URL 待补标可选）。

---

## 9. 图片识别 / 自动表情库 / 语义回图

> 目标：**自动抓取群聊表情包 → 用 qwen3.7-plus 总结内容 → 之后发送语境合适的图片。**  
> 产品形态对齐 smart_imagechat_hub 的「偷图 + 转述标签 + 语义选图」，存储与发送走本仓库 Mongo + COS + 官方 file_info。

### 9.1 能力矩阵

| 能力                      | 阶段     | 说明                                                       |
| ------------------------- | -------- | ---------------------------------------------------------- |
| **qwen3.7-plus 看图转述** | P2 起 ✅ | 对话附图 + 入库打标共用                                    |
| **自动抓取群聊图/表情**   | P2 起 ✅ | 白名单群全量消息中的 `attachments`                         |
| **summary + tags 入库**   | P2 起 ✅ | 供语义检索，不只存裸 URL                                   |
| **回复时语义选图发送**    | P2 起 ✅ | 按 bot 回复意图 / 用户要图 / 主动表情概率                  |
| **人工审核**              | ✅       | 默认 `pending`，设置页通过后 `ready`；可编辑 summary/tags；`stickerAutoApprove` 可跳过 |
| **动图**                  | ✅       | 按图片发送（`msg_type:7` / `file_info`），不走 QQ 表情体系 |
| **多图批量分析**          | ✅       | 同一请求批量分析，请求形态按官方文档                       |
| **感知哈希去重**          | ✅       | 同表情反复出现不重复入库                                   |
| **斗图 / 队形**           | P3 可选  | 窗口统计，非核心                                           |

### 9.2 自动抓取流水线（偷图）

```
群消息(attachments)
  → 是否 chatbot 白名单群？否 → 忽略
  → 类型/大小门禁（如 ≤1MB 优先表情；可配）
  → 发送者黑名单？丢弃
  → 计算 contentHash / phash
  → 已在 chatSticker 或拒绝列表？跳过
  → 下载 → 上传 COS（key: chatbot/sticker/{groupOpenid}/{hash}.ext）
  → 尺寸启发式拦截聊天长截图/App 大屏等非表情包（动画除外）
  → contentHash 精确去重 + **dHash 感知哈希相似去重**（汉明距离 ≤ stickerDedupHamming，默认 8；在 vision 前）
  → analyze（qwen3.7-plus → summary + tags + nsfw + **严格 is_meme**）
  → is_meme=false 或 summary/tags 命中「聊天记录/截图/界面…」→ 不入库
  → nsfw_risk=high → status: rejected
  → 否则：`stickerAutoApprove` ? ready : **pending**（写入 contentHash + phash）
  → 设置页人工通过 → ready，可供检索发送；可编辑 summary/tags
```

**触发时机：**

- **与观察写库并行**：过准入的带图消息，除写入 `chatContext` 外，**异步**投递「入库队列」（Redis list / 内存队列 + 单飞），避免阻塞回复路径。
- 仅 **PlanaBot + chatbot.groups**；不抓其它 bot 进程。
- 可选：只抓「小图/表情比例」或全部图片（配置 `stickerCaptureMode: 'emoji_like' | 'all_images'`）。

nsfw_risk=high：不限于图库拒收；对话场景中附图触发 nsfw 时，由 dpsk 按人设输出**性格化的拒绝回复**。

**配置建议：**

| 字段                      | 含义                | 建议默认                     |
| ------------------------- | ------------------- | ---------------------------- |
| `stickerCaptureEnabled`   | 总开关              | true                         |
| `stickerCaptureMode`      | 抓取范围            | `all_images` 或 `emoji_like` |
| `stickerAutoApprove`      | 跳过人工审核        | **false**（需审核）          |
| `stickerMaxBytes`         | 单张上限            | 1～2 MB                      |
| `stickerLibraryMax`       | ready+pending 合计  | 300～1000                    |
| `stickerBlacklistUserIds` | 不抓取的用户        | []                           |

设置页 API：`GET /api/settings/stickers`、`POST .../status`（含 pending→ready）、`POST .../update`（summary/tags）、`POST .../delete`。

### 9.3 Mongo：`chatSticker`（表情/图片库）

```ts
{
  _id: string,                 // hash 或 ObjectId
  botType: 'PlanaBot',
  groupOpenid?: string,        // 来源群；也可全局库 groupOpenid='*'
  cosKey: string,              // 发送用
  sourceUrl?: string,          // 原始附件 URL（可能过期）
  contentHash: string,         // 去重
  phash?: string,
  summary: string,             // qwen3.7-plus 一句话总结 —— 检索主字段（可人工编辑）
  tags: string[],              // 情绪/角色/梗/OCR（可人工编辑）
  nsfwRisk: 'low' | 'mid' | 'high',
  status: 'pending' | 'ready' | 'rejected' | 'hidden',  // pending=待审；仅 ready 可被选图
  width?: number,
  height?: number,
  byteSize?: number,
  captureFromMsgId?: string,
  captureAuthorId?: string,
  useCount: number,            // 被 bot 发出次数
  lastUsedAt?: Date,
  ts: Date,
}
```

索引：

- `{ status: 1, groupOpenid: 1, ts: -1 }`
- `{ contentHash: 1 }` unique
- 可选文本：`summary` + `tags` 的文本索引，或后续 embedding（一期可用 **关键词 / LLM 选 id**）

### 9.4 对话附图 vs 入库

| 场景             | chatContext                   | chatSticker                |
| ---------------- | ----------------------------- | -------------------------- |
| 用户附图闲聊     | 必写；`visionSummary` 给 dpsk | 异步尝试入库（若开启抓取） |
| 纯观察带图       | 写 observe + 可选 summary     | 同样可入库                 |
| bot 自己发出的图 | assistant 记录（必入 Mongo）  | 不重复抓自己刚发的（防环） |

### 9.5 后续「发送合适图片」— 选图策略

在 dpsk **已决定要回复**（或 Must）后：

1. **结构化动作**（优先）：

```json
{
    "action": "reply",
    "parts": [
        { "type": "text", "text": "喵～这个好懂！" },
        { "type": "library_image", "query": "无语 翻白眼 表情包", "reason": "吐槽" }
    ]
}
```

2. **检索实现（一期简单可靠；Top-K LLM 精排归 P3）**：
    - 用 `query` / 当前回复文本 / 用户意图，在 `status=ready` 且 `nsfwRisk!=high` 的集合中：
        - **A. 标签/摘要关键词打分**（分词命中 tags、summary 包含）
        - **B. 或二次小请求**：把 Top-K（如 15 条）的 `{id, summary, tags}` 交给 dpsk/`qwen3.7-plus` 选一个 id（成本略高）
    - 命中 → `cosUrl(cosKey)` → `sendMsgEx({ imageUrl })`
    - 未命中 → 仅发文字

3. **主动附带表情**：文字回复成功后，以 `stickerReplyProbability` 触发选图（query=刚发文本的情绪）。

4. **用户要图**：Must 文本含「表情包/发图/来张」等关键词 → 提高选图权重或强制 `library_image`。

**禁止**：模型直接输出任意 http 外链当图片源；**只允许** `chatSticker` 中 ready 的 `cosKey`。

### 9.6 接收与发送技术细节

**接收**

- `msg.attachments[]` → axios `arraybuffer`（同 `soutubot`）。
- 门禁：张数、`stickerMaxBytes`、mime。
- 对话路径写入 `chatContext.images[].visionSummary`；入库路径写 `chatSticker.summary/tags`。

**发送**

- COS → 官方上传 `file_info` → `msg_type=7`（现有 `sendMsgEx`）。
- **动图（gif 等）同样按图片发送**，不单独接入 QQ 表情体系。
- 每轮建议 ≤ 1 文 + 1 图；发送成功 `useCount++`。
- **所有发送必须记录 MongoDB**：chatContext 写 assistant 行；表情发送同步更新 `chatSticker.useCount` / `lastUsedAt`。

**存储原则**

- 元数据与 summary：**仅 Mongo**。
- 二进制：**COS**（非 `memoryDir` 对话记忆）。

---

## 10. MCP 接入（部分）

### 10.1 定位

参照 MumuBot：工具扩展，但 **默认最小集**。

### 10.2 建议范围

| 类型                           | 一期      | 说明                                             |
| ------------------------------ | --------- | ------------------------------------------------ |
| 只读信息类                     | ✅ 可选   | 天气、日程查询等（若有现成 MCP）                 |
| 群内无害表达                   | ✅        | 与「发消息/表情」重叠的可仍走内部 tool，不必 MCP |
| 写操作 / shell / 任意 URL 抓取 | ❌ 默认关 | 需显式配置 + admin                               |
| 泄露内部配置                   | ❌        | 禁止                                             |

### 10.3 实现要点

- 配置：`mcpServers: [{ name, transport, url/command, enabledTools[] }]`；已接入实现：连接成功即注入 tools（`server_tool` 前缀命名），dpsk 原生 function calling 循环（`maxToolRounds` 上限），结果以 `role:'tool'` 回填，超时 15s、结果截断 2000 字
- 仓库内置测试服务：`script/mcp/weather-server.cjs`（stdio；wttr.in 数据源、无需密钥；工具 `get_weather` / `get_weather_forecast`），`ai.json` 已配置 `mcp.enabled=true` 并接入
- 抓取模式：`stickerCaptureMode=sticker`（默认）收动画表情（gif/webp）或小尺寸静态表情包（jpg/png ≤512px 或 ≤512KB），普通大照片不保存；`animated_only` 只收动画；`stickerCaptureStore=false` 时可选择只打标不入库
- dpsk **tool calling**（若模型支持）或 ReAct JSON 步；超时与步数上限（如 max 3 hops）。
- 工具结果再注入模型时当 **tool 角色**，用户不可伪造。
- 审计：可选 Mongo 记 tool 调用摘要。

---

## 11. 安全边界

| 控件       | 规格                                                                                    |
| ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| 超长       | `content.length > maxUserChars` → **`ignored: true` 落库**，不调模型，不进 history 原文 |
| 角色隔离   | 用户只进 `role:user`；system 仅来自配置                                                 |
| 分隔包装   | 用户段标记不可信                                                                        |
| 注入特征   | 可选检测后 ignored 或固定拒答                                                           |
| nsfw       | 附图/入库 `nsfw_risk=high` → 图库拒收；对话中由 dpsk 按人设输出**性格化拒绝回复**       |
| 风控（H2） | 自部署 **`Qwen3Guard-Stream-0.6B`** 门控（**Must 不经过**），输出 `noop                 | reply`；`noop` 必记录（含上下文与用户信息） |
| MCP        | 白名单 tools + 超时 + 禁止危险默认                                                      |
| 输出       | schema；禁回显密钥；sticker 白名单；字数上限                                            |
| 失败       | Hybrid 静默；Must 可短错误一次                                                          |

---

## 12. 配置目标形态（汇总）

```ts
interface BotChatbotConfig {
    enabled: boolean;
    groups: string[];

    systemPrompt: string; // 猫娘人设，设置页可改
    mustPrefixes: string[]; // 匹配: ^prefix\s+
    adminOpenid?: string; // 最高管理员 openid；留空不启用特殊标记

    replyProbability: number; // 0.1
    replyToBotProbability: number; // 0.7
    replyChainWindowSec?: number;
    decideMode: 'hybrid'; // H2 门控见下方 gate，noop 必记录

    /** H2 风控（最后配置，P3 启用；Must 默认不过，applyToMust 可开启） */
    gate?: {
        enabled: boolean; // 已启用
        model: string; // Qwen3Guard-Stream-0.6B（自部署）
        baseURL: string; // 默认 http://127.0.0.1:8000（FastAPI /moderate）
        timeoutMs?: number; // 默认 10000；门控输入已截断（历史 4 轮×40 字 + 本轮 400 字），CPU 推理通常 3-6s
        applyToMust?: boolean; // 默认 false；true 时 @/先导词也过门控
        refusalMessages?: string[]; // 违禁拦截短提示台词池（随机取一条；炸毛/傲娇等状态语气）
    };

    maxUserChars: number;
    maxContextTokens: number; // 1_000_000
    workingContextTokens: number; // 日常工作窗口 k；token 估算优先 API usage，否则本地 tokenizer
    maxHistoryRounds: number;
    compressInterval: number; // 条数条件
    compressTokenThreshold: number; // token 条件（双条件 OR）；摘要由 dpsk 生成
    maxSummaryBlocks: number;
    historyTTL?: number;

    chatModel: string;
    baseURL?: string;
    // dsKey 在 BotConfig 层

    /** 默认 qwen3.7-plus */
    visionModel: string;
    visionBaseURL?: string;
    visionApiKey: string; // 独立密钥，不复用 dsKey / aiTranslate.apiKey

    stickerCaptureEnabled: boolean;
    stickerCaptureMode: 'emoji_like' | 'all_images';
    stickerMaxBytes: number;
    stickerLibraryMax: number;
    stickerBlacklistUserIds?: string[];
    stickerReplyProbability?: number; // 文字回复后附带图库表情的概率

    mcp?: {
        enabled: boolean; // 一期默认 false，仅留配置空间
        servers: McpServerConfig[]; // 具体 server 后续配置
        maxToolRounds?: number; // 默认 max 3 hops
    };

    rateLimitPerSecond: number; // 1
    rateLimitPerMinute: number; // 10
    cooldownSec: number;

    // 废弃作为记忆路径：
    // memoryDir?: string;
}
```

---

## 13. AI 逻辑参照细节（实现 checklist）

### 13.1 Muice

- [x] 群内 @ 必回
- [x] 非 @ 随机回
- [ ] 主动找聊定时（**不做**，除非另开需求）
- [x] 表情相关能力（图库语义回图）

### 13.2 AstrBot

- [x] 基础概率约 0.1
- [x] 群上下文注入（公共历史 + observe）
- [x] 压缩阈值思想（双条件 + working 窗口）
- [x] 图转述后再进主模型

### 13.3 MumuBot

- [x] 可沉默（noop / 未抽中）
- [x] 记忆分层（raw + summary）
- [x] vision 独立（`qwen3.7-plus`）
- [x] 表情收集 + 决策发送
- [x] 部分 MCP
- [ ] 完整 ReAct 人格情绪系统（**不一期照搬**，保持轻量）

### 13.4 smart_imagechat_hub

- [x] 自动收集群图
- [x] LLM 摘要/标签
- [x] 语义选图发送
- [x] 主动附带表情概率
- [x] 去重 / 上限 / **人工审核池（pending）+ 摘要编辑**

---

## 14. 实现分期（按最新决议）

| 阶段   | 内容                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | Plana + 白名单 `aiAllow`（`group_openid`，删除硬编码与 `^chat`）；Mongo `chatContext`（含 observe / ignored / **bot 出站**，按消息 id（msgId）去重）；Must（`is_you` + `prefix\s+`）；动态概率 0.1 / 0.7；限流 1/s、10/min；Redis 3h 出站缓存；dpsk 猫娘文本；设置页 `systemPrompt` 等字段；**存量仅清理 opts，其余仅加 `@deprecated` 注释暂不改** |
| **P1** | 双条件压缩（**dpsk 摘要**）+ `chatMemory`；working/1M 预算（API usage / tokenizer）；接话窗口状态                                                                                                                                                                                                                                                                    |
| **P2** | **`qwen3.7-plus` 看图**（独立密钥、多图批量）；**自动抓取表情 → summary/tags → `chatSticker`（默认 pending 待审）**；动图按图发送；nsfw 性格化拒答；语义选图发送；主动附带表情概率；发送记录强制 Mongo                                                                                                                                                                |
| **P3** | **MCP 接入（已实现：stdio/http/sse + dpsk function calling，server 清单待配置）**；**H2 风控门控（已实现：自部署 `Qwen3Guard-Stream-0.6B`，默认 Must 不过、applyToMust 可开，noop 记录上下文与用户信息）**；**设置页图库管理（已实现：列表/搜索/pending 审核/编辑摘要/隐藏/恢复/拒绝/删除，COS 同步删除，手机单行布局）**；选图 Top-K LLM 精排；斗图窗口                                                                                                                                                    |

---

## 15. 验收标准（更新）

1. 仅 Plana 白名单（`group_openid`）产生 AI 闲聊。
2. 指令优先，不与先导词抢（有 opts 不进 chatbot）；旧 `^chat` 路由已删除。
3. `@`（`mentions.is_you`）与 `xxx␠...` 必回；`xxx` 无空格不触发先导词。
4. 普通消息长期回复率约 **10%**；回复 bot 后窗口内约 **70%** 接话。
5. 不回的消息仍在 Mongo 且可进上下文（非 ignored）；**bot 其余 @ 消息与回复也有 Mongo 记录**。
6. 超长：`ignored:true`，无模型调用，原文不进 prompt。
7. 压缩在「条数或 token」触达时由 **dpsk** 生成摘要。
8. 设置页改 `systemPrompt` 后新对话呈猫娘/新文案。
9. 有图时 **`qwen3.7-plus`**（独立密钥、多图批量）摘要写入后再由 dpsk 回复（配置齐全时）。
10. 群图可被自动抓取入库（**默认 pending 人工审核**，可编辑 summary/tags）；通过后 summary/tags 用于语义发图。
11. 发出的图必须来自 `chatSticker` COS，无任意外链；**动图按图片发送**。
12. 无本地对话记忆文件。
13. 限流 **1 条/秒、10 条/分** 生效且可配置。
14. nsfw 命中时按人设给出性格化拒绝回复。
15. 所有 bot 发送（含表情）均可在 Mongo 查到记录。
16. 去重统一按消息 id（msgId）；出站记录发送成功仅写一次（重试不重复写），不按 content hash 严格去重。
17. H2 启用时使用自部署 `Qwen3Guard-Stream-0.6B`，**Must 不经过门控**；`noop` 记录含上下文与用户信息。
18. 存量仅清理 opts；其余存量代码仅加 `@deprecated` 注释，结构/行为不变。

---

## 16. 仍可选的微调项（非阻塞）

1. `mustPrefixes` 最终列表（默认可先 `星奈` / 猫娘昵称）。
2. `maxUserChars`、`workingContextTokens`、双条件具体数字（含 `compressTokenThreshold` ratio）——**非关键数值参照其余 bot 实现取值**。
3. 接话窗口长度与是否允许 0.7 连续多轮（`replyChainWindowSec` / 链长上限）。
4. MCP 具体 server 清单：**待部署时配置**（设置页 mcp.servers JSON 或 ai.json）。
5. `emoji_like` 判定阈值、`stickerMaxBytes` / `stickerLibraryMax` 具体数值。
6. 猫娘默认 prompt：**参照主流 chatbot 内置一版**，终稿可由运营在设置页覆盖。
7. H2 已冻结：自部署 `Qwen3Guard-Stream-0.6B`、`gateBaseURL` 默认 `http://127.0.0.1:8000`（POST `/moderate`）、**只判定本次用户消息**（截断 600 字）、Must 默认不过门控（`applyToMust` 可开启；拦截从 `refusalMessages` 随机短提示、故障放行）、`noop` 记录含上下文与用户信息；判定映射 `Safe`→reply，`Controversial`/`Unsafe`→noop，服务故障→error（非 Must fail-closed）。

---

## 17. 风险摘要

| 风险                                           | 缓解                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0.7 接话连环刷屏                               | 窗口 + 群 RPM + 链长上限                                                              |
| 全量 + 公共 observe token 涨                   | 双条件压缩 + working 窗口                                                             |
| 先导词误伤                                     | 强制 `prefix + 空白`                                                                  |
| MCP 滥用                                       | 白名单 + 默认关危险工具                                                               |
| **qwen3.7-plus 调用费**（对话+全量偷图双路径） | 入库异步队列限速；重复 hash 跳过；观察图可「只入库不立刻打标」合并批处理              |
| 垃圾/违规表情入库                              | nsfw 拒收、黑名单用户、库上限、**pending 人工审核**、可编辑/拒绝/删除                  |
| 选图不合适                                     | 仅 ready；关键词+可选 LLM 精排；confidence 阈值                                       |
| 设置页改人设注入                               | system 仍拼接固定安全段                                                               |
| 发送记录缺失/重复                              | 发送层统一记录；按消息 id（msgId）幂等（验收项 15/16）              |
| content hash 去重误伤                          | 已取消 content hash 严格去重；相同内容可正常重复记录（按消息 id 区分） |
| `group_id` / `groupMap` / `isOffical` 存量依赖 | 新代码统一 `group_openid`；**存量暂不改动，仅加 `@deprecated` 注释**（后续清理）      |

---

## 18. 一句话结论

> **PlanaBot 白名单群（`group_openid`，已全量）指令优先；否则观察写入 Mongo 公共历史（含未回与 bot 出站）；超长 ignored 落库；@（`is_you`）或「先导词+空格」必回；普通 0.1 / 回 bot 后 0.7；限流 1/s、10/min；猫娘人设可设置页改；dpsk 主回复与压缩；看图与表情打标统一用阿里云 `qwen3.7-plus`（独立密钥、多图批量）；自动抓取群聊图 → summary/tags 入库（默认 pending 人工审核，可编辑摘要）→ 通过后语义发送合适图片；nsfw 性格化拒答；所有发送必入 Mongo；可选 MCP（H2 风控最后配置）；无本地记忆文件。**

---

## 19. 参考链接

### 本仓库

- `src/eventRec.ts`、`src/plugins/chatbot.ts`、`src/libs/IMessageEx.ts`
- `src/plugins/soutubot.ts`、`src/plugins/translate.ts`
- `config/settings.schema.json`、`transport.md`、`AGENTS.md`

### 外部

- [SugarMGP/MumuBot](https://github.com/SugarMGP/MumuBot)
- [Mai-with-u/MaiBot](https://github.com/Mai-with-u/MaiBot)
- [Moemu/Muice-Chatbot](https://github.com/Moemu/Muice-Chatbot)
- [AstrBotDevs/AstrBot](https://github.com/AstrBotDevs/AstrBot) · [上下文压缩](https://docs.astrbot.app/use/context-compress.html)
- [JREion/astrbot_plugin_smart_imagechat_hub](https://github.com/JREion/astrbot_plugin_smart_imagechat_hub)
- [ouyangyanhuo/ModelChat](https://github.com/ouyangyanhuo/ModelChat)
- [阿里云模型列表（含 qwen3.7-plus）](https://help.aliyun.com/zh/model-studio/models)
- [阿里云图像与视频理解](https://help.aliyun.com/zh/model-studio/vision)
- [QQ 富媒体 / 群消息](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html)
- [DeepSeek API](https://api-docs.deepseek.com/)

---

_文档随需求决议修订；落地以实现 PR 与当时 API 为准。_
