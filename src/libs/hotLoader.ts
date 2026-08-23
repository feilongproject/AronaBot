import fs from 'node:fs';
import path from 'node:path';

/**
 * 热加载注册器（在 src/index.ts 首行 import 本模块触发注册）。
 *
 * 思路（业务代码零改动，全部保持原生 `import()` 语法）：
 * - 覆盖 `Module._extensions['.ts']`：注册之后加载的所有 TS 统一由 babel 内存
 *   编译为 CJS（不落盘）；
 * - 编译时用自定义 babel 插件把「动态 import()」翻译成 `__hotLoad(spec, __filename)`；
 * - `__hotLoad` 是自定义状态控制加载器：维护版本化注册表，配合 require.cache 完成
 *   缓存命中 / 失效重载，替代原生 import() 的不可控缓存。
 *
 * 注意：require.extensions 处理器必须是同步的，故这里用 require 同步加载
 * babel@7（CJS）；babel@8 为 ESM-only 无法用于此场景。
 */

const Module = process.getBuiltinModule('module') as unknown as {
    _extensions: Record<string, (mod: unknown, filename: string) => void>;
    _cache: Record<string, { exports: unknown }>;
    _load(request: string, parent: unknown, isMain?: boolean): unknown;
};

/** 自定义状态注册表：绝对路径 → { 版本, 命名空间 } */
const _state = new Map<string, { version: number; exports: unknown }>();

/** 解析动态 import 的 specifier 为绝对路径（相对调用文件；自动补扩展名） */
function _resolveSpec(spec: string, fromFile: string): string {
    const abs = path.isAbsolute(spec)
        ? path.normalize(spec)
        : path.resolve(path.dirname(fromFile), spec);
    if (path.extname(abs)) return abs;
    for (const ext of ['.ts', '.tsx', '.js', '.json', '.mjs', '.cjs']) {
        if (fs.existsSync(abs + ext)) return abs + ext;
    }
    for (const ext of ['.ts', '.tsx', '.js']) {
        const index = path.join(abs, `index${ext}`);
        if (fs.existsSync(index)) return index;
    }
    return abs;
}

/**
 * 状态控制加载器（由 babel 翻译动态 import() 后调用）：
 * - 命中自定义状态 且 require.cache 未失效 → 返回缓存实例（单例）；
 * - 否则清 require.cache 重新编译加载，并更新状态。
 */
function _hotLoad(spec: string, fromFile: string): Promise<unknown> {
    const abs = _resolveSpec(spec, fromFile);
    const cached = _state.get(abs);
    if (cached && Module._cache[abs]) return Promise.resolve(cached.exports);

    delete Module._cache[abs];
    const exports = Module._load(abs, null, false);
    _state.set(abs, { version: (cached?.version ?? 0) + 1, exports });
    return Promise.resolve(exports);
}

/** 注册 babel 编译 + 动态 import 翻译（预加载时执行一次） */
export function registerHotLoader(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const babel = require('@babel/core') as typeof import('@babel/core');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const presetTS = require('@babel/preset-typescript');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cjsPlugin = require('@babel/plugin-transform-modules-commonjs');
    const { types: t } = babel;

    /** 把 `import(spec)` → `__hotLoad(spec, __filename)` */
    const dynamicImportPlugin = () => ({
        visitor: {
            CallExpression(callPath: any) {
                const callee = callPath.node.callee;
                if (callee.type !== 'Import') return;
                const [spec] = callPath.node.arguments || [];
                if (!spec) return;
                callPath.replaceWith(
                    t.callExpression(t.identifier('__hotLoad'), [spec, t.identifier('__filename')]),
                );
            },
        },
    });

    const previousHandler = Module._extensions['.ts'];
    Module._extensions['.ts'] = function hotTsHandler(mod: unknown, filename: string) {
        try {
            const source = fs.readFileSync(filename, 'utf8');
            const result = babel.transformSync(source, {
                filename,
                presets: [[presetTS, { allowNamespaces: true, onlyRemoveTypeImports: true }]],
                plugins: [dynamicImportPlugin, [cjsPlugin]],
                sourceMaps: 'inline',
                babelrc: false,
                configFile: false,
            });
            const code = result?.code;
            if (!code) throw new Error(`babel 编译结果为空: ${filename}`);
            (mod as { _compile(code: string, filename: string): void })._compile(code, filename);
        } catch (err) {
            // 编译失败回退 tsx 原处理器，避免拖垮进程
            if (previousHandler) return previousHandler(mod, filename);
            throw err;
        }
    };

    (globalThis as { __hotLoad?: typeof _hotLoad }).__hotLoad = _hotLoad;
}

// 被 index.ts 首行 import 时即完成注册
registerHotLoader();
