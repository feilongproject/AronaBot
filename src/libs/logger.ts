import log4js from 'log4js';
const log = log4js
    .configure({
        appenders: {
            console: {
                type: 'console',
                layout: {
                    type: 'pattern',
                    /**
                     * %s call stack
                     * %C class name
                     * %M method or function name
                     * %A method or function alias
                     * %F fully qualified caller name
                     */
                    pattern: global.devEnv
                        ? '%[[%d] [%f:%l:%o:%F] [%p]%] %m'
                        : '%[[%d] [%f:%l:%o] [%p]%] %m',
                },
            },
        },
        categories: {
            default: {
                appenders: ['console'],
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
