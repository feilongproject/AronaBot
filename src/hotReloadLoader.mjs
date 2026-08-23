/**
 * ESM resolve hook：对 hotLoadConfigs 中的文件自动注入版本号查询参数，
 * 使每次文件变更后 import() 得到新的 URL → 绕过 ESM 模块注册表缓存。
 *
 * 与主线程通过 MessagePort 通信接收版本更新。
 */

const versionMap = new Map();
let port = null;

export function initialize(data) {
    port = data?.port;
    if (port) {
        port.on('message', ({ type, key, version }) => {
            if (type === 'version') {
                versionMap.set(key, version);
            }
        });
        port.unref();
    }
}

export async function resolve(specifier, context, nextResolve) {
    try {
        const resolved = await nextResolve(specifier, context);
        let url = resolved.url;

        // 仅处理 file:// URL（排除 node:、data: 等）
        if (!url.startsWith('file://')) return resolved;

        // 查找匹配的版本：目录以 / 结尾（前缀匹配），文件精确匹配
        for (const [key, version] of versionMap) {
            const isMatch = key.endsWith('/')
                ? url.startsWith(key)
                : url.split('?')[0] === key;
            if (isMatch) {
                const [base, existingQuery] = url.split('?');
                const newQuery = `v=${version}`;
                url = existingQuery
                    ? `${base}?${newQuery}&${existingQuery.replace(/(^|&)v=\d+&?/, '$1').replace(/&$/, '')}`
                    : `${base}?${newQuery}`;
                break;
            }
        }

        return { ...resolved, url };
    } catch (err) {
        return nextResolve(specifier, context);
    }
}
