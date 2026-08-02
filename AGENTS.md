# AronaBot Agent 开发文档

> 本文档从仓库现有实现中提炼，供 AI / 开发者后续生成与修改代码时对齐写法。  
> 项目定位：基于 `qq-bot-sdk` 的 QQ 频道 / Q 群机器人（碧蓝档案主题），多 bot 进程（AronaBot / PlanaBot / TestBot）。

---

## 1. 技术栈与运行方式

| 项 | 约定 |
|---|---|
| 语言 | TypeScript（`strict: true`），CommonJS 模块 |
| 运行 | `tsx -r dotenv/config src/index.ts <BotType> [--dev]`（加载根目录 `.env`） |
| 包管理 | pnpm |
| QQ SDK | `qq-bot-sdk@1.9.1` |
| HTTP | Koa + `@koa/router` + `koa-body`（webhook） |
| 缓存 | Redis（业务状态、禁言、历史、按钮 eventId 等） |
| 持久化 | MariaDB（可选，`allowMariadb`）；部分功能用本地 JSON |
| 图片 | `sharp` / `@napi-rs/canvas` + 腾讯 COS 上传后发图 |
| 定时 | `node-schedule` |
| 热更新 | `chokidar` 监听 `src/plugins/`、`config/opts.ts` 等 |
| 格式化 | Prettier：`semi`、单引号、`printWidth: 100`、`tabWidth: 4`、`trailingComma: all` |

常用脚本：

```bash
pnpm run dev:AronaBot   # nodemon + tsx + --dev
pnpm run start:AronaBot # 生产启动（tsx 直接跑 TS）
pnpm run typecheck      # tsc --noEmit
pnpm run format         # prettier --write src/
```

---

## 2. 目录结构（生成代码时落点）

```
AronaBot/
├── config/
│   ├── config.ts / config.example.ts   # 密钥、端口、路径、bot 配置
│   └── opts.ts                         # ★ 命令路由表（按顺序匹配）
├── data/                               # 静态资源、JSON、攻略图、键盘布局等
├── src/
│   ├── index.ts                        # Koa webhook 入口 + 事件总线挂载
│   ├── bootloader.ts                   # 运行时全局初始化
│   ├── init.ts                         # redis/mariadb/ws/client/热加载/频道树
│   ├── eventRec.ts                     # ★ 事件分发 → 消息封装 → 插件调用
│   ├── handlerSync.ts                  # OneBot 同步（当前多为注释保留）
│   ├── constants/                      # EventMap 等常量
│   ├── libs/                           # 公共库（消息类、common、logger…）
│   ├── plugins/                        # ★ 业务插件（一个功能域一个文件）
│   └── types/                          # 全局类型与 d.ts
├── script/                             # 运维/攻略更新脚本
└── transport.md                        # 消息传输路径说明
```

**新增功能默认只改：**

1. `src/plugins/<name>.ts` — 业务逻辑  
2. `config/opts.ts` — 注册命令  
3. 必要时：`config/config.ts` 路径/密钥、`data/` 资源、`src/types/` 类型  

**不要随意改：** `eventRec.ts` 分发骨架、`IMessageEx.ts` 发送协议、webhook 签名校验，除非明确在修基础设施。

---

## 3. 消息主链路（生成代码必须遵守的调用关系）

```
官方 Webhook POST /webhook/{botType}
  → 签名校验 (client.webhookApi.validSign)
  → EventMap 映射 rootType
  → global.ws.emit(rootType, { eventId, eventType, msg })
  → eventRec(event)
      → new IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C
      → findOpts(msg) 匹配 config/opts.ts
      → import(`./plugins/${opts.path}.ts`)
      → await plugin[opts.fnc](msg)
```

要点：

- 插件**不注册自己**；由 `opts.path` + `opts.fnc` 动态 import 并调用**导出的同名函数**。
- `path` 对应文件名：`./plugins/${path}.ts`。
- `fnc` 必须是该文件的 **named export function**，且为 `async`。
- 频道消息走 `executeChannel`（会写 executeRecord 到 DB）；群/C2C 走 `executeChat`。
- 插件内异常由 `eventRec` 捕获并 `mailerError`，插件里仍应对用户可见错误做 `sendMsgEx` / `catch`。

跨进程：

- 生产实例在 Redis `devEnv` 开启时会把 webhook 镜像到 dev 端口。

---

## 4. 插件写法规范

### 4.1 文件与导出

```ts
// src/plugins/example.ts
import { IMessageC2C, IMessageGROUP, IMessageGUILD, IMessageDIRECT } from '../libs/IMessageEx';
import config from '../../config/config';
// 需要时再 import common / sharp / axios 等

/** 与 opts.ts 中 fnc 字段同名 */
export async function exampleCmd(
    msg: IMessageGUILD | IMessageGROUP | IMessageC2C | IMessageDIRECT,
) {
    // 1. 参数解析（正则从 msg.content 取）
    // 2. 权限 / 限流 / 业务校验
    // 3. 业务逻辑
    // 4. 回复用户
    return msg.sendMsgEx({ content: 'ok' });
}
```

约定：

| 规则 | 说明 |
|---|---|
| 命名 | 文件名 camelCase / 功能名：`gacha.ts`、`serverStatus.ts`、`rollpig.ts` |
| 导出 | 仅 export 命令入口函数；内部 helper **不 export**（或仅跨插件复用时 export） |
| 入口签名 | `async function fnc(msg: IMessage…): Promise<any>` |
| 消息类型 | 按命令实际场景收窄联合类型，不要无脑写全部 4 种 |
| 配置 | `import config from '../../config/config'` |
| 日志 | 全局 `log`（`log.info` / `log.debug` / `log.error` / `log.mark`），**不要**新建 logger |
| 开发日志 | `if (devEnv) log.debug(...)` |
| 管理员 | `adminId.includes(msg.author.id)` |
| 错误 | 用户侧：`msg.sendMsgExRef({ content: '...' })`；严重错误可 `throw` 或 `mailerError` / `sendToAdmin` |

### 4.2 命令注册（`config/opts.ts`）

结构为**两层**：`command.<path>.<keyChild>`。

```ts
// config/opts.ts
import { MessageType } from '../src/libs/IMessageEx';

export default {
    desc: '命令总览json,按照顺序进行匹配',
    command: {
        example: {                          // path → plugins/example.ts
            exampleCmd: {                   // keyChild，仅用于标识
                reg: /^\/?示例命令\s*(.*)$/, // 匹配正文（会先去掉 <@id> 再 trim）
                fnc: 'exampleCmd',          // 必须等于 export 函数名
                type: [MessageType.GUILD, MessageType.GROUP],
                channelAllows: ['all'],     // 频道：'all' | 键名引用 channelAllows
                describe: '一句话说明',
                export: '/示例命令 [参数]', // 可选；有则出现在 /帮助
            },
        },
    },
    channelAllows: { /* 见现有配置 */ },
} as CommandConfig.Root;
```

`CommandConfig.Command` 字段含义：

| 字段 | 类型 | 说明 |
|---|---|---|
| `reg` | `RegExp` | 对清理 @ 后的 `msg.content` 做 `RegExp.test` |
| `fnc` | `string` | 插件导出函数名 |
| `type` | `MessageType[]` | 允许的消息场景 |
| `channelAllows` | `string[]?` | 频道子频道白名单；默认按 `common`；`'all'` 全开 |
| `describe` | `string` | 描述 |
| `export` | `string?` | 帮助菜单展示文案，`\n` 可多行示例 |
| `data` | `string?` | 可选附加数据（少用） |

匹配规则（`findOpts`）：

1. **按 `command` 对象键顺序**遍历，先匹配先生效。  
2. 跳过 `type` 不包含当前 `msg.messageType` 的项。  
3. 去掉 `<@!id>` / `<@id>` 后 `trim` 再测正则。  
4. 群 / C2C 匹配到即返回；频道还需 `channelAllows` / `devEnv` / 私信豁免。

**新增命令检查清单：**

- [ ] `opts.path` 文件存在  
- [ ] `opts.fnc` 有同名 `export async function`  
- [ ] `type` 与函数参数消息类一致  
- [ ] 需要帮助展示时写 `export`  
- [ ] 正则避免过于宽泛导致抢匹配（注意声明顺序）

### 4.3 定时任务（`plugins/schedule.ts`）

不走 opts，由 `init()` `import('./plugins/schedule')` 加载。

```ts
const scheduleTables: ScheduleTable[] = [
    {
        desc: '任务描述',
        rule: '0 */3 * * * ?',  // node-schedule cron
        func: () => import('./xxx').then((m) => m.someJob()),
        enable: botType == 'AronaBot',  // 按 bot 开关
    },
];
// devEnv 使用 scheduleTablesDev
```

新增定时：只改 `scheduleTables` / `scheduleTablesDev`，保持 `scheduleAutoLoad` 不变。热更新会 re-import schedule。

---

## 5. 消息类型与回复 API

### 5.1 MessageType

```ts
enum MessageType {
    DIRECT = 'DIRECT',  // 频道私信
    GUILD  = 'GUILD',   // 频道公屏
    GROUP  = 'GROUP',   // QQ 群
    FRIEND = 'FRIEND',  // C2C 好友
}
```

对应类：`IMessageDIRECT` / `IMessageGUILD` / `IMessageGROUP` / `IMessageC2C`。

### 5.2 常用字段

| 字段 | 频道 GUILD/DIRECT | 群 GROUP | C2C FRIEND |
|---|---|---|---|
| `msg.id` | 消息 id（回复用） | ✓ | ✓ |
| `msg.content` | 正文 | ✓ | ✓ |
| `msg.author.id` | 用户 id | openid 等 | ✓ |
| `msg.guild_id` / `channel_id` | ✓ | — | — |
| `msg.group_id` / `group_openid` | — | ✓ | — |
| `msg.mentions` | 用户列表 | CUser[] | — |
| `msg.attachments` | 附件 | ✓ | ✓ |
| `msg.opts` | 匹配到的命令 | ✓ | ✓ |
| `msg.event_id` | — | 推送用 | ✓ |

### 5.3 回复方法（优先用封装，不要直接裸调 SDK，除非特殊能力）

```ts
// 纯文本（string 重载）
await msg.sendMsgEx('pong');

// 对象形式
await msg.sendMsgEx({ content: '...' });

// 引用回复
await msg.sendMsgExRef({ content: '...' });

// 图片：本地路径 / Buffer / 远程 URL
await msg.sendMsgEx({ content: '说明', imagePath: '/tmp/x.png' });
await msg.sendMsgEx({ content: '说明', imageFile: buffer });
await msg.sendMsgEx({ content: '说明', imageUrl: cosUrl('key/file.png') });

// Markdown + 键盘（群/C2C 更完整；频道依赖 eventId）
await msg.sendMarkdown({
    content: `文本\n![img #宽px #高px](${imageUrl})`,
    keyboardNameId: 'gacha', // 对应 data/keyboardMap.ts
    // 或 keyboard: { content: { rows: [...] } }
});
```

场景差异（生成代码时注意）：

- **群图**：通常先 `cosPutObject` 再 `imageUrl: cosUrl(...)`，或 `msgType: 7` + `fileInfo` 流程（封装在 `sendMsgEx` 内）。  
- **@用户**：群场景常不支持或表现不同，现有代码常用：  
  `msg instanceof IMessageGROUP ? '' : \`<@${msg.author.id}>\``  
- **Markdown 降级**：`allowMarkdown` 为 false 或构造失败时封装会 fallback 到 `sendMsgEx`。

### 5.4 发送选项关键字段（`SendOption`）

```ts
{
  content?: string;
  imagePath?: string;
  imageUrl?: string;
  imageFile?: Buffer;
  msgId?: string;      // 默认 this.id
  eventId?: string;    // 群主动推送
  ark?: Ark;
  ref?: boolean;
  // 群侧
  msgType?: 0|1|2|3|4|7;
  fileType?: 1|2|3;    // 图/视频/语音
  sendToId?: string;
}
```

发送统一经 `callWithRetry`：失败重试 `config.retryTime` 次，并处理 url 不允许、文件过大、msg 过期等错误码。

---

## 6. 全局变量与工具（禁止重复发明）

在 `bootloader.ts` / `init.ts` / `types.d.ts` 中注入，插件内**直接使用**：

| 全局 | 用途 |
|---|---|
| `log` | log4js 日志 |
| `redis` | Redis 客户端 |
| `mariadb` | MariaDB 连接（可能未启用） |
| `client` | qq-bot-sdk OpenAPI |
| `ws` | 进程内事件总线 |
| `botType` | `'AronaBot' \| 'PlanaBot' \| ...` |
| `meId` / `meAppId` / `meRealId` | 机器人身份 |
| `adminId` | 管理员 id 列表 |
| `devEnv` | 是否 `--dev` |
| `allowMarkdown` | 是否允许 MD |
| `commandConfig` | 当前 opts |
| `studentInfo` / `studentNameAlias` | 学生数据全局对象 |
| `saveGuildsTree` | 频道树 |
| `botStatus` | 发送/出图计数 |
| `_path` | `process.cwd()` |
| `sleep(ms)` | Promise 延时 |
| `strFormat(obj)` | 更友好的 stringify |
| `fixName(name)` | 学生名规范化 |
| `cosUrl(key, fix?)` | COS 带签 URL（默认 `!Image3500K`） |
| `cosPutObject(params)` | 上传对象到 COS |
| `isNumStr(s)` | 是否纯数字字符串 |

公共函数（`src/libs/common.ts`）：

- `sendToAdmin(content)` — 通知管理员（回调群；`callbackToGroup`，频道侧已废弃）  
- `pushToDB(table, data)` — 插入 MariaDB（`devEnv` 下直接 return）  
- `searchDB(table, key, value)`  
- `settingUserConfig(aid, 'GET'|'SET', data)` — Redis hash `setting:{aid}`  
- `callWithRetry(fn, args)` — 发送重试  
- `timeConver(ms)` — 时长文案  

邮件：`mailerError(context, err)`。

---

## 7. 典型功能模式（生成时对号入座）

### 7.1 纯文本命令

参考：`help.ts`、`admin.ping`、`Tarot`（文本部分）。

```ts
export async function foo(msg: IMessageGUILD | IMessageGROUP) {
    const arg = /^\/?foo\s*(.*)$/.exec(msg.content)?.[1]?.trim();
    if (!arg) return msg.sendMsgExRef({ content: '用法: /foo <参数>' });
    return msg.sendMsgEx({ content: `结果: ${arg}` });
}
```

### 7.2 用户状态 / 每日一次（Redis）

参考：`Tarot.ts`。

```ts
const key = `Feature:${dayStartSec}`;
const has = await redis.hGet(key, msg.author.id);
if (!has) {
    await redis.hSet(key, msg.author.id, value);
    await redis.expireAt(key, dayEndSec);
}
```

Key 命名习惯：`域:子域:id` 或 `功能名:时间戳`，如：

- `ban:use:user` / `ban:use:group` / `ban:use:guild`  
- `setting:{aid}`  
- `fileInfo:cache:{sendToId}:{url}`  
- `received:{eventType}:{eventId}`  
- `groupLastestEventId:{botType}:{groupId}`  
- `chat:history:{target}`

### 7.3 生成图片 → COS → 发送

参考：`ALA.ts`、`gacha.ts`。

```ts
const fileName = `${msg.author.id}-${Date.now()}.png`;
const imageBuffer = await buildImage(...); // sharp / canvas
const outPath = `${config.imagesOut}/xxx-${fileName}`;
fs.writeFileSync(outPath, imageBuffer);

await cosPutObject({
    Key: `feature/${fileName}`,
    Body: imageBuffer,
    ContentLength: imageBuffer.length,
});

return msg.sendMsgEx({
    content: msg instanceof IMessageGROUP ? '' : `<@${msg.author.id}>`,
    imageUrl: cosUrl(`feature/${fileName}`),
});
// 或 sendMarkdown + ![img #wpx #hpx](url)
```

注意：

- 出图后可 `botStatus.imageRenderNum++`（若统计需要）。  
- 大图 COS 可用 `cosUrl(key, '')` 去掉压缩后缀。  
- Markdown 图片须带宽高：`![img #${w}px #${h}px](url)`（`image-size` 取尺寸）。

### 7.4 Markdown + 内联命令按钮

参考：`handbook.ts`。

```ts
function mdCmdLink(showDesc: string, command: string, enter = true) {
    command = command.replace(/\(/g, '（').replace(/\)/g, '）');
    return [
        `[${showDesc}]`,
        `(mqqapi://aio/inlinecmd?command=${encodeURI(command)}&reply=false&enter=${enter})`,
        '\r',
    ];
}
```

键盘布局放 `data/keyboardMap.ts`，通过 `keyboardNameId` 引用；也可内联 `keyboard.content.rows[].buttons[]`。

### 7.5 管理员命令

参考：`admin.ts`。

```ts
export async function dangerous(msg: IMessageGUILD | IMessageGROUP | IMessageC2C) {
    if (!adminId.includes(msg.author.id))
        return msg instanceof IMessageGUILD
            ? undefined
            : msg.sendMsgEx({ content: '无权限调用' });
    // ...
}
```

### 7.6 权限 / 身份组（频道）

参考：`mute.ts`：读 `msg.member.roles`，结合 Redis `allowRoles:mute:{guildId}`，用 `client.muteApi` / `client.memberApi` 等官方 API。

### 7.7 用户配置

```ts
const setting = await settingUserConfig(msg.author.id, 'GET', ['server']);
await settingUserConfig(msg.author.id, 'SET', { server: 'jp' });
```

### 7.8 跨 bot 群推送

```ts
// 在任意 bot 进程
await (await import('./interaction')).sendToGroupHandler('echo', content);
// PlanaBot 侧 commandMap.echo / dynamicPush 执行
```

新增推送类型：在 `interaction.commandMap` 注册函数，签名：

```ts
(args: { eventId: string; groupId: string; btnData: string }) => Promise<any>
```

### 7.9 外部 API / AI

参考：`chatbot.ts`、`translate.ts`。

- HTTP：`axios`  
- 配置密钥放 `config`，不写死在插件  
- chatbot 类功能注意：sanitize 输入、Redis 历史 TTL、本地 memory 目录  

### 7.10 模块级初始化

参考：`gacha.ts` 顶部 `gachaReload('local')`。

```ts
// 文件加载时执行一次（热更新会再执行）
initData().catch((err) => {
    log.error(err);
    return sendToAdmin(`初始化失败: ${err}`);
});
```

---

## 8. 数据与配置约定

### 8.1 config

- 真密钥：`config/config.ts`（通常不入库或本地覆盖）  
- 模板：`config/config.example.ts`  
- 路径类配置集中在 config，插件用 `config.imagesOut`、`config.handbookRoot` 等，**禁止硬编码绝对路径**（`workspace` 例外在 config 内）。

### 8.2 data/

- JSON / 图片资源 / `keyboardMap.ts` / 攻略图目录  
- 可读：`fs.readFileSync(path).json<T>()`（Buffer 扩展）  
- 可热加载的全局数据类实现 `reload()`（见 `StudentInfo` / `StudentNameAlias`）

### 8.3 MariaDB

```ts
await pushToDB('tableName', { col1: val1, col2: val2 });
// devEnv 下跳过
// INSERT 字段来自 object keys，对象值会 JSON.stringify
```

### 8.4 封禁体系

`eventRec.isBan` 检查：

- `ban:use:user` → author.id  
- `ban:use:group` → group_id  
- `ban:use:guild` → guild_id  

命令级频道禁用：`ban:opt:guild` set member = `${path}:${keyChild}:${guild_id}`。

---

## 9. 代码风格与实现习惯

1. **async/await** 为主；链式 `.then` 也存在于旧代码，新代码优先 async/await。  
2. **正则解析参数**优先 `exec` + `groups`，失败给用户用法提示。  
3. **早 return** 做权限与参数校验。  
4. 用户可见错误信息里，点号有时需 `.replaceAll('.', ',')` 或 `。`，规避 QQ 侧链接检测（历史踩坑）。  
5. 不要在插件里改 `global.ws` 监听；特殊事件在 `eventRec` 分支处理。  
6. 插件内需要时再 `await import('./otherPlugin')`，利于热更新与循环依赖。  
7. 类型：业务 namespace 可写在插件文件底部（如 `sign.ts` 的 `namespace SignData`）；跨模块类型放 `src/types/`。  
8. 注释：中文即可；不写显而易见的废话注释。  
9. 未启用/废弃文件可用 `___` 前缀或 `.b` 后缀（如 `___ostracism.ts`），新功能不要用此方式除非明确废弃。  
10. Prettier 4 空格；生成代码后应可被 `pnpm run format` 接受。

---

## 10. 新增功能标准流程（Agent 执行清单）

1. **定场景**：GUILD / DIRECT / GROUP / FRIEND 哪些需要。  
2. **建插件** `src/plugins/<path>.ts`，export 入口函数。  
3. **注册** `config/opts.ts` 的 `command.<path>.<key>`。  
4. **需要资源** 时：路径写入 config，文件放 `data/`。  
5. **需要定时** 时：改 `schedule.ts`。  
6. **需要键盘** 时：改 `data/keyboardMap.ts`。  
7. **需要推送命令** 时：改 `interaction.commandMap`。  
8. **权限**：用户命令默认开放；管理命令 `adminId`；频道子频道用 `channelAllows`。  
9. **状态**：优先 Redis；需审计/统计再 MariaDB；简单本地 JSON 仅在同类已有先例时使用。  
10. **回复**：文本 `sendMsgEx`/`sendMsgExRef`；图 COS + `imageUrl`；复杂卡片 `sendMarkdown`。  
11. **验证**：`devEnv` 下用管理员账号触发；看 log 中 `plugins/${path}:${fnc}`。  
12. **不要**提交密钥、不要改无关插件、不要大规模重构发送层。

---

## 11. 插件函数模板速查

### 最小可用插件

```ts
// src/plugins/hello.ts
import { IMessageGROUP, IMessageGUILD } from '../libs/IMessageEx';

export async function hello(msg: IMessageGUILD | IMessageGROUP) {
    return msg.sendMsgEx({
        content: `你好${msg instanceof IMessageGROUP ? '' : ` <@${msg.author.id}>`}`,
    });
}
```

```ts
// config/opts.ts 的 command 中增加：
hello: {
    hello: {
        reg: /^\/?hello$/,
        fnc: 'hello',
        type: [MessageType.GUILD, MessageType.GROUP],
        channelAllows: ['all'],
        describe: '打招呼',
        export: '/hello',
    },
},
```

### 图片插件骨架

```ts
import fs from 'fs';
import sharp from 'sharp';
import { IMessageC2C, IMessageGROUP, IMessageGUILD } from '../libs/IMessageEx';
import config from '../../config/config';

export async function drawSomething(msg: IMessageGUILD | IMessageGROUP | IMessageC2C) {
    const name = `${msg.author.id}-${Date.now()}.png`;
    const buf = await sharp({
        create: { width: 400, height: 200, channels: 3, background: '#fff' },
    })
        .png()
        .toBuffer();

    fs.writeFileSync(`${config.imagesOut}/demo-${name}`, buf);
    await cosPutObject({ Key: `demo/${name}`, Body: buf, ContentLength: buf.length });

    return msg.sendMsgEx({
        content: '生成完成',
        imageUrl: cosUrl(`demo/${name}`),
    });
}
```

---

## 12. 反模式（禁止）

| 不要 | 原因 |
|---|---|
| 在插件里 `createWebsocket` / 新 Koa 端口 | 入口已统一 |
| 绕过 `IMessage*` 直接到处裸 POST 消息 | 丢失重试、计数、msg_id 处理 |
| 命令函数不 export 或改名不同步 opts | 运行时报 `not found function` |
| 用默认导出作为命令入口 | 加载逻辑是 `plugin[opts.fnc]` |
| 在 `findOpts` 之外自建第二套命令路由（除非 chatbot 类兜底） | 与 ban/日志/热更新不一致 |
| 把密钥写进插件 | 用 config |
| 生产路径写死 `/root/...` 在插件内 | 用 config 变量 |
| 无校验执行管理员 API | 必须 `adminId` 或身份组 |
| 忽略群/频道 @ 与 content 差异 | 群 `clean_content`、频道 mention 替换 |

---

## 13. 关键文件索引

| 需求 | 读哪里 |
|---|---|
| 命令怎么匹配 | `src/libs/IMessageEx.ts` → `findOpts`；`config/opts.ts` |
| 事件怎么进插件 | `src/eventRec.ts` |
| 怎么发消息 | `src/libs/IMessageEx.ts` |
| 全局初始化 | `src/bootloader.ts`、`src/init.ts` |
| 类型定义 | `src/types/types.d.ts` |
| 传输拓扑 | `transport.md` |
| 配置样例 | `config/config.example.ts` |
| 抽卡/出图范例 | `src/plugins/gacha.ts`、`ALA.ts` |
| 攻略/MD 范例 | `src/plugins/handbook.ts` |
| 管理命令范例 | `src/plugins/admin.ts` |
| 定时任务 | `src/plugins/schedule.ts` |
| 群推送 RPC | `src/plugins/interaction.ts` |
| Redis 用户设置 | `src/libs/common.ts` → `settingUserConfig` |

---

## 14. 一句话原则

**「opts 声明路由，plugins 导出同名 async 函数，统一用 IMessage 封装收发，状态优先 Redis，出图走 COS，配置进 config，风格跟现有插件一致。」**

---

## 15. Git 提交与 GPG 签名（本机 / Agent）

> 全局细则见用户级规则：`~/.grok/rules/git-gpg-signing.md`。此处仅作仓库内提醒。

- 本环境提交默认需要 GPG 签名；Agent shell 无 TTY，**不能**在对话中交互输入 GPG 密码。
- Agent **不得**擅自关闭 `commit.gpgsign`，**不得**在命令中传递密码短语。
- 签名失败时：请用户在真实终端执行 `export GPG_TTY=$(tty)` 后用 `gpg --clearsign`（或等价操作）解锁 `gpg-agent` 缓存，再重试提交。
- 仅当用户明确要求时，才可对当次提交关闭签名。
