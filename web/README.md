# AronaBot Settings Web

Vue 3 + Vite + Tailwind CSS v4 实现的配置设置页。

## 开发

先启动 bot（提供 `/api/settings/*`），再开前端：

```bash
# 根目录
pnpm web:dev
# 本机:    http://127.0.0.1:5173/settings/
# 局域网:  http://10.0.0.x:5173/settings/  （host: true，可被 10.0.0.0/24 访问）
# API 代理目标默认 http://127.0.0.1:2341（AronaBot dev）
# 若 bot 以生产模式监听 2340：
VITE_API_TARGET=http://127.0.0.1:2340 pnpm web:dev
```

设置页为**分组表单**（Web / Bots / Redis / COS / 路径…），按配置项编辑。

字段说明来自 `config/settings.schema.json`（不是 JSONC 注释）。  
配置文件首行应有：

```json
"$schema": "./settings.schema.json"
```

IDE（VS Code / Cursor）会补全与校验；Web 表单也会用 schema 的 `description` 作字段提示。

## 构建

```bash
pnpm web:build
# 产物输出到 ../public/settings/
# bot 通过 http://<host>:<webhookPort>/settings 提供
```

## 目录

```
web/
  src/
    api.ts                 # 鉴权与配置 API
    App.vue
    components/
      LoginPanel.vue
      EditorPanel.vue
    style.css              # Tailwind 入口
  vite.config.ts           # base=/settings/，outDir=public/settings
```
