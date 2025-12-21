import schedule from 'node-schedule';
import { sendToAdmin } from '../libs/common';
import { callbackPushButton } from '../libs/interactionGroup';

const scheduleTables: ScheduleTable[] = [
    {
        desc: 'redis自动保存',
        rule: '0 * * * * ? ',
        func: () => redis.bgSave().then((v) => log.mark(`保存数据库:${v}`)),
        enable: botType == 'AronaBot',
    },
    {
        desc: '事件更新',
        rule: '0 */3 * * * ?',
        func: () => import('./admin').then((module) => module.updateEventId()),
        enable: botType == 'AronaBot',
    },
    {
        desc: 'bilibili动态检查',
        rule: '0 */3 * * * ? ',
        func: () =>
            import('./biliDynamic')
                .then((module) => module.mainCheck())
                .catch((err) => {
                    log.error(err);
                    return sendToAdmin(strFormat(err).replaceAll('.', ',')).catch(() => {});
                }),
        enable: botType == 'AronaBot',
    },
    {
        desc: 'callback事件更新',
        rule: '0 */3 * * * ?',
        func: callbackPushButton,
        enable: botType === 'PlanaBot',
    },
];

const scheduleTablesDev: ScheduleTable[] = [
    {
        desc: 'dev环境看门狗',
        rule: '*/10 * * * * ? ',
        func: () => redis.setEx('devEnv', 10, botType),
        enable: true,
    },
    // {
    //     desc: '测试',
    //     rule: '* * * * * *',
    //     func: () => log.debug('测试debuglog'),
    //     enable: true,
    // },
];

scheduleAutoLoad().catch((err) => log.error(err));

export async function scheduleAutoLoad() {
    await schedule.gracefulShutdown();

    for (const t of devEnv ? scheduleTablesDev : scheduleTables) {
        if (!t.enable) continue;
        log.info(`正在注册定时任务: ${t.desc}, ${t.rule}`);
        schedule.scheduleJob(t.rule, t.func);
    }
}

interface ScheduleTable {
    desc: string;
    rule: string;
    func: () => any;
    enable: boolean;
}
