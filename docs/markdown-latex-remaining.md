# 群 / C2C Markdown + LaTeX 待改造清单

> 塔罗牌（`src/plugins/Tarot.ts`）已完成，本文只记**尚未改**的群聊 / C2C 展示。  
> 频道（GUILD / DIRECT）插件一律不做。未点名改造前不要改代码。

---

## 已确认的约束（后续改造必须遵守）

来自官方能力与塔罗迭代，不要再踩：

| 项 | 约定 |
|---|---|
| 场景 | 只改 `GROUP` / `FRIEND`（C2C）。混注册命令时频道路径保持原样，或从 `opts.ts` 去掉频道。 |
| 发送 | 用户可见卡片走 `sendMarkdown`；`allowMarkdown` 关闭或失败会降级 `sendMsgEx`。 |
| 官方 MD | 标题、加粗/斜体/删除线、链接、`![img #wpx #hpx](url)`、列表、引用、分割线、`\u200B`。无表格。 |
| 仓库额外标签 | `<qqbot-at-user>`、`<qqbot-cmd-input>`、`mqqapi://aio/inlinecmd`。 |
| **禁止 HTML** | `<div>` / `<center>` / `<p align>` 均不生效。 |
| 居中 | `$$...$$` 会居中；`$...$` 行内左对齐。默认不要居中，除非该插件明确要求。 |
| 图片 | 用现成 COS / 公网 URL + `![img #宽px #高px]`。**不要**为对齐或排版用 sharp 重画、垫透明底、再上传。出图类插件（抽卡图、ALA、logo）本身的 canvas/sharp 保留。 |
| LaTeX 用途 | 短标签：色块 `\colorbox`、字号 `\Large`、注音 `\overset`、Fraktur `\mathfrak`。长文案用 MD，不要整段塞进 `\text{}`。 |
| `\mathfrak` | 只用于拉丁字母；空格会被吞掉，按单词拆：`\mathfrak{The}\ \mathfrak{Fool}`。不要套中文。 |
| 不可进公式 | 用户输入、模型输出、外站标题、译文、配置 dump。`$` `\` `_` 需当正文或转义。 |
| 降级 | 公式文案去掉 `$...$` 后仍应能读。 |

参考实现：`src/plugins/Tarot.ts`（行内 ruby + 色块 + 原图 MD 内嵌 + 斜体解读）。试验场：`src/plugins/test.ts`（`latex1` / `latex2`）。

---

## 已完成

| 插件 | 说明 |
|---|---|
| `Tarot.ts` | 仅群 / C2C；频道命令已从 `opts.ts` 删除。JSON 中英文字段拆分。 |
| `serverStatus.ts` | 仅群 / C2C 改 Markdown：`## 服区` 标题 + 正常（绿）/维护中（红）色块 + 维护信息列表。频道 / 频道私信及 `allowMarkdown` 关闭时保持旧版纯文本（逐字一致）。维护公告原文不进公式，进正文前去掉 `$` 与反斜杠。 |

---

## 待改造（按建议顺序）

### P0

#### `help.ts`

- 现状：纯文本 `> 命令 === 描述` 长列表，`sendMsgEx`。
- 群侧目标：按功能分组（抽卡 / 攻略 / 小猪…）；`export` 做成内联命令或 `<qqbot-cmd-input>`。
- LaTeX：最多分组小色块；**命令字面量不要进公式**（用户会当成要输入的字符）。
- 参数说明（`<必填>` / `[选填]`）用 MD 引用，不要公式。
- `opts.ts` 仍含 GUILD：只改群发送，或同时从帮助的频道匹配里摘掉。

---

### P1

#### `gacha.ts` — `gachaString`

- 现状：`(★★★)(desc)name` 纯文本。`gachaImage` 已是 MD。
- 目标：名单改 MD 列表；三星行可上色，一/二星保持列表。
- 不要把十连 10 行都做成公式。

#### `gacha.ts` — `gachaImage` 统计行

- 图片 + 键盘已 MD。
- 可补：服区小色块；`今日出货概率` / 三星计数用 `\textcolor` 或 `\boxed`（短标签）。
- 黑名单/错误提示：一句 `\textcolor` 即可。

#### `handbook.ts` — `searchHandbook` 多结果

- 单结果已 MD + 图 + 键盘。
- 多结果仍是 `sendMsgEx` 纯名单，应对齐角评模糊搜索的 `mdCmdLink`。
- 主路径可补服区色块（日服 / 国际服 / 国服）。攻略正文是图，不要公式化。

#### `checkRelation.ts`

- 现状：把 URL 当纯文本。
- 目标：`[打开好友回忆](http://ti.qq.com/friends/recall?uin=...)`。
- 无需 LaTeX。

---

### P2

#### `commandSetting.ts`

- 设置结果 + `gacha` 键盘已 MD。
- 可补：`当前卡池` / `分析显示` 做成两个短色块。非必须。

#### `soutubot.ts`

- 结果卡已 MD + 键盘。标题来自外站，**禁止**进公式。
- 可补：相似度阈值上色（≥阈值绿、low 灰）。
- 现有 `` ``` `` 包标题不必改成公式。进度/无权限等仍是 `sendMsgEx`，可顺手改短 MD。

#### `studentInfo.ts` — `alias`（管理）

- 候选按钮流已 MD。
- 可补：模糊结果拼音 `\overset{pinyin}{\text{名字}}`（仅管理员群 / C2C）。

#### `admin.ts` — 仅群 / C2C 会碰到的

| 命令 | 建议 |
|---|---|
| `status` | MD 键值列表；不必把内存数字做成公式。短状态标签可上色。 |
| `ban` | 结果用 MD；成功/已存在可用红绿色块。**理由是自由文本，不要进公式。** |
| `ping` / `restart` / `hotLoad` | 维持一句纯文本。 |
| `reloadStudentData` / `reloadGachaData` | 运维回执，纯文本或简单 MD。 |
| `dumpChatRecord` | 出图，不改。 |

频道专用：`dmsMe`、`sendTopMessage`、`directToAdmin` — **跳过**。

#### `ALA.ts` / `logo.ts`

- 主体是出图，canvas/sharp **保留**（这是功能本身，不是为对齐重画）。
- 可把发出去的图改成 markdown 内嵌（与十连图一致）。
- 用法错误可用 MD + 一句 `\textcolor`（如「命令与文字之间必须有空格」）。
- 「生成中...」不必公式。

#### `transcoding.ts` — `help`

- 命令列表适合 MD 无序列表。
- 进度 / 错误码保持纯文本或等宽。不要 `\frac`。

#### `groupInfo.ts`

- 当前实际发出的是调试字段（openid、真实群号）。
- 调试：MD 键值列表即可。
- 文件后半段官方 `groupApi.info` 在 `return` 之后，是死代码；若以后接活，权限开关可用色块。

---

## 发送层已是 Markdown（可选点缀，非必须）

这些**不算「未改造」**，只在有明确需求时再动：

| 插件 | 说明 |
|---|---|
| `rollpig.ts` | 已 MD + 键盘。无图降级、找猪 ID 色块、拼音注音都是可选。 |
| `commandSetting.ts` / `receiveFull` | 已 MD；全量接收警告已是标题/链接。 |
| `biliDynamic.ts` 群推送 | 作者 + 链接 + 截图。动态标题来自 B 站，不要公式。 |
| `gachaImage` 主体 | 见 P1 统计行。 |
| `handbook` 主路径 | 见 P1 多结果 / 服区标签。 |
| `studentInfo.alias` 按钮 | 见 P2 拼音。 |
| `interaction.ts` `syncgroup` | 测试用，不必 LaTeX。 |
| `wifu.ts` | 结婚卡已写 MD，但入口 `if (1) return` 整段关闭。恢复功能时再用现成代码；离婚一句不必公式。 |
| `chatbot.ts` | **发送已是 `sendMarkdown`**。人设禁止模型输出 MD/列表。不要让模型写 LaTeX。若做「语言优化」，只允许发送层对固定系统短句套公式（限流、看不了图、门控拒绝、闭嘴确认）。`@` 继续 `<qqbot-at-user>`。 |

---

## 明确不做

| 插件 | 原因 |
|---|---|
| `translate.ts` 译文 | 不可信字符串；已有引号规范化与 `.`→`。`（躲链接检测），不要换成公式。最多加 `## 译文`。 |
| `info.ts` | 配置 dump，`#` `_` 与路径冲突。继续纯文本切片。 |
| `cqCode.ts` | 转存 zip 进度 ACK。 |
| `twitter.ts` | 未产品化。 |
| `annal.ts` | 逻辑与 opts 均已注释。 |
| `pusher.ts` | opts 空对象。 |
| `test.ts` | LaTeX 试验场，不当用户功能。 |
| 运维一句 ACK | ping / 重启 / 热加载等。 |
| `___*` 废弃插件 | 不讨论。 |

---

## 频道专用（本轮范围外，不要改展示）

- `mute.ts`、`sign.ts`、`sponsor.ts`
- `AvalonSystem.ts`（监控、晒卡举报等）
- `admin.ts`：`dmsMe`、`sendTopMessage`、`directToAdmin`

日志子频道、JSON、坐标调试输出不要套公式。

---

## 建议下一刀

1. **`help.ts`（群）**：命令导航，内联命令收益最大。  
2. **`gachaString` + handbook 多结果 + `checkRelation`**：改动面小、和现有 MD 卡片对齐。

每改一个插件前：先定是否居中（默认否）、公式只打在机器人生成的短词上、图片用原 URL。
