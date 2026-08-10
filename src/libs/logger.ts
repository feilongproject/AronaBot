import fs from 'fs';
import path from 'path';
import log4js from 'log4js';
import config from '../../config/config';

/**
 * 日志输出约定：
 * - 开发环境（--dev）：所有级别（含 trace/debug）输出到 console，不写任何文件
 * - 正式环境：
 *   - console：默认仅 INFO 及以上；settings.debugLog=true 时额外输出 DEBUG 及以上
 *   - 主日志：INFO 及以上 → log/<BotType>_<yyyy-MM-dd--HH:mm:ss>.log（按进程启动时间一个文件）
 *   - 调试日志：settings.debugLog=true 时，仅 DEBUG 级别 → log/debug/<BotType>_<yyyy-MM-dd--HH:mm:ss>.log
 *   - log.mark 级别高于 INFO，正式环境主日志与控制台均会输出
 * - debugLog 热加载立即生效：自定义 appender 在事件发生时实时读取 config.debugLog
 */

// logger 模块加载早于 initRuntime，与 bootloader 相同方式识别运行环境与 bot 类型
const devEnv = process.argv.includes('--dev');
const botTypeName =
    (Object.keys(config.bots).find((v) => process.argv.includes(v)) as BotTypes | undefined) || '';

/** 进程启动时间（与 PM2/release 脚本命名一致：{Bot}_{YYYY-MM-DD--HH:MM:SS}.log） */
const startedAt = (() => {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}--${p(d.getHours())}:${p(
        d.getMinutes(),
    )}:${p(d.getSeconds())}`;
})();

const logRoot = path.join(global._path, 'log');
const mainLogFile = path.join(logRoot, `${botTypeName}_${startedAt}.log`);
const debugLogFile = path.join(logRoot, 'debug', `${botTypeName}_${startedAt}.log`);

// 开发环境不写任何文件；正式环境且识别到 bot 类型时才写文件
const useFiles = !devEnv && Boolean(botTypeName);

const CONSOLE_PATTERN = devEnv ? '%[[%d] [%f:%l:%o:%F] [%p]%] %m' : '%[[%d] [%f:%l:%o] [%p]%] %m';
const FILE_PATTERN = '[%d] [%f:%l:%o] [%p] %m';

/**
 * 控制台 appender（动态级别过滤）：
 * - 开发环境：全量输出
 * - 正式环境：INFO 及以上恒输出；DEBUG 仅在 settings.debugLog 开启时输出
 */
const consoleAppender: log4js.AppenderModule = {
    configure(_cfg, layouts, _find, levels) {
        const layout = layouts!.layout('pattern', { pattern: CONSOLE_PATTERN, tokens: {} });
        // eslint-disable-next-line no-console
        const consoleLog = console.log.bind(console);
        return (event) => {
            if (devEnv) return consoleLog(layout(event));
            if (event.level.isGreaterThanOrEqualTo(levels!.INFO)) return consoleLog(layout(event));
            // 事件发生时实时读取 config.debugLog，保存设置后热加载立即生效
            if (event.level.isEqualTo(levels!.DEBUG) && config.debugLog) {
                return consoleLog(layout(event));
            }
        };
    },
};

/**
 * 调试日志 filter appender：仅 DEBUG 级别，且 settings.debugLog 开启时才转发给 debug 文件。
 * 内置 logLevelFilter 级别固定，无法热更新，故用自定义 appender 实时读取 config.debugLog。
 */
const debugFilterAppender: log4js.AppenderModule = {
    configure(cfg, _layouts, findAppender, levels) {
        // 类型声明缺少 name 参数，运行时签名是 findAppender(appenderName)
        const find = findAppender as unknown as (name: string) => log4js.AppenderFunction;
        const appender = find(cfg!.appender);
        return (event) => {
            if (config.debugLog && event.level.isEqualTo(levels!.DEBUG)) appender(event);
        };
    },
};

const appenders: Record<string, log4js.Appender> = {
    console: { type: consoleAppender },
    ...(useFiles
        ? {
              // maxLevel 默认是 FATAL，会丢掉 MARK；显式放宽到 mark（MARK 恒进主日志）
              mainFilter: {
                  type: 'logLevelFilter',
                  appender: 'mainFile',
                  level: 'info',
                  maxLevel: 'mark',
              },
              mainFile: {
                  type: 'file',
                  filename: mainLogFile,
                  layout: { type: 'pattern', pattern: FILE_PATTERN },
              },
              debugFilter: { type: debugFilterAppender, appender: 'debugFile' },
              debugFile: {
                  type: 'file',
                  filename: debugLogFile,
                  layout: { type: 'pattern', pattern: FILE_PATTERN },
              },
          }
        : {}),
};

if (useFiles) {
    fs.mkdirSync(logRoot, { recursive: true });
    fs.mkdirSync(path.join(logRoot, 'debug'), { recursive: true });
}

const log = log4js
    .configure({
        appenders,
        categories: {
            default: {
                // 只挂入口：console + 过滤器；mainFile/debugFile 仅由过滤器内部引用
                appenders: useFiles ? ['console', 'mainFilter', 'debugFilter'] : ['console'],
                level: 'all',
                enableCallStack: true,
            },
        },
    })
    .getLogger();

log.setParseCallStackFunction((error: Error, linesToSkip: number) => {
    const lineMatch =
        /at (?:(?<method>.+)\s+\()?(?:(?<path>.+?):(?<line>\d+)(?::(?<col>\d+))?|([^)]+))\)?/.exec(
            error.stack!.split('\n')[linesToSkip],
        )?.groups;
    if (!lineMatch) return;
    return {
        fileName: lineMatch.path.replace(_path, '').replace(/^[\/\\]/, ''),
        lineNumber: Number(lineMatch.line),
        columnNumber: Number(lineMatch.col),
        callerName: lineMatch.method,
    } as any as log4js.CallStack;
});
export default log;
