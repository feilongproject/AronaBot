import { settingUserConfig } from '../libs/common';
import { IMessageC2C, IMessageGROUP, IMessageGUILD } from '../libs/IMessageEx';
import config from '../../config/config';

export async function commandSetting(msg: IMessageGUILD | IMessageGROUP | IMessageC2C) {
    var optStr: string = '';
    var expCmd: string | null = null;
    const nowDay = new Date().setHours(0, 0, 0, 0) + 1000 * 60 * 60 * 24;
    const status = await settingUserConfig(msg.author.id, 'GET', ['server', 'analyzeHide']);
    const regs = [
        { reg: /更改抽卡分析显示/, cmd: 'changeAnalyzeHide' },
        { reg: /更改服务器/, cmd: 'changeServer' },
        { reg: /清空今日抽卡数据/, cmd: 'chearTodayData' },
        { reg: /清空全部抽卡数据/, cmd: 'chearAllData' },
        { reg: /重置/, cmd: 'reset' },
    ];

    for (const _reg of regs) if (_reg.reg.test(msg.content)) expCmd = _reg.cmd;

    switch (expCmd) {
        case 'changeAnalyzeHide':
            status.analyzeHide = String(!(status.analyzeHide == 'true'));
            optStr = await settingUserConfig(msg.author.id, 'SET', status).then(() => {
                return `已${status.analyzeHide == 'true' ? '隐藏' : '显示'}抽卡统计信息`;
            });
            break;
        case 'changeServer':
            status.server = status.server == 'jp' ? 'global' : 'jp';
            optStr = await settingUserConfig(msg.author.id, 'SET', status).then(() => {
                return `已更改服务器为${status.server == 'jp' ? '日服' : '国际服'}`;
            });
            break;
        case 'chearTodayData':
            optStr = await redis
                .hSet(`data:gacha:${nowDay}`, [
                    [`${msg.author.id}:global`, '0,0,0,0'],
                    [`${msg.author.id}:jp`, '0,0,0,0'],
                ])
                .then(() => {
                    return `已清空今日统计信息`;
                });
            break;
        case 'chearAllData':
            optStr = await redis
                .hSet(`data:gacha:all`, [
                    [`${msg.author.id}:global`, '0,0,0,0'],
                    [`${msg.author.id}:jp`, '0,0,0,0'],
                ])
                .then(() => {
                    return redis.hSet(`data:gacha:${nowDay}`, [
                        [`${msg.author.id}:global`, '0,0,0,0'],
                        [`${msg.author.id}:jp`, '0,0,0,0'],
                    ]);
                })
                .then(() => {
                    return '已清空全部统计信息';
                });
            break;
        case 'reset':
            status.server = 'global';
            status.analyzeHide = '0';
            optStr = await settingUserConfig(msg.author.id, 'SET', status)
                .then(() => {
                    return redis.hSet(`data:gacha:all`, [
                        [`${msg.author.id}:global`, '0,0,0,0'],
                        [`${msg.author.id}:jp`, '0,0,0,0'],
                    ]);
                })
                .then(() => {
                    return redis.hSet(`data:gacha:${nowDay}`, [
                        [`${msg.author.id}:global`, '0,0,0,0'],
                        [`${msg.author.id}:jp`, '0,0,0,0'],
                    ]);
                })
                .then(() => {
                    return '已重置所有设置!';
                });
            break;
    }

    return msg.sendMarkdown({
        params_omnipotent: [
            (msg instanceof IMessageGROUP ? '' : `<@${msg.author.id}> `) + optStr,
            `\r当前卡池选择: ${status.server == 'jp' ? '日服' : '国际服'}卡池`,
            `\r抽卡分析显示状态: ${status.analyzeHide == 'true' ? '隐藏' : '显示'}`,
            '\r注: 使用按钮可以快速设置',
        ],
        keyboardNameId: 'gacha',
        // markdown 部分

        content:
            (msg instanceof IMessageGROUP ? '' : `<@${msg.author.id}> `) +
            optStr +
            `\n当前卡池选择: ${status.server == 'jp' ? '日服' : '国际服'}卡池` +
            `\n抽卡分析显示状态: ${status.analyzeHide == 'true' ? '隐藏' : '显示'}` +
            `\n注: 以下子命令须在本命令后加空格使用` +
            `\n-  清空今日抽卡数据` +
            `\n-  清空全部抽卡数据` +
            `\n-  更改抽卡分析显示` +
            `\n-  更改服务器` +
            `\n-  重置`,
        // fallback 部分
    });
}

export async function receiveFull(msg: IMessageGROUP) {
    // 从用户指令中提取群号（仅匹配“全量接收”后紧跟的数字 ID）
    const groupCode = msg.content.match(/全量接收\s*(\d+)/)?.[1] || '';
    if (!groupCode) {
        return msg.sendMarkdown({
            content:
                `# ⚠️ 请提供群号\n` +
                `<qqbot-cmd-input text="${encodeURIComponent('/全量接收 ')}" show="📋 一键填入指令" reference="false" />`,
        });
    }

    // 构造 open_kuikly_info 的 JSON 数据
    const kuiklyInfo = JSON.stringify({
        page_name: 'ai_group_service_agreement_pop_page',
        groupCode: groupCode,
        botUin: meRealId,
        botUid: config.bots[botType].botUid,
        screen: 1,
    });

    // 拼接完整链接
    const applyUrl = `https://club.vip.qq.com/transfer?open_kuikly_info=${encodeURIComponent(kuiklyInfo)}`;

    // TODO: 替换为实际的操作示意图片 URL（上传至 COS 后使用 cosUrl 获取）
    const guideImageUrl = `${config.cosUrl}/receive_full_guide_${botType}.jpg`;

    return msg.sendMarkdown({
        content:
            `# 🔔 全量接收权限申请\n` +
            `![操作示意 #1200px #1000px](${guideImageUrl})\n` +
            `---\n` +
            `## 🔗 [点击前往申请全量接收权限](${applyUrl})\n` +
            `## ⚠️ 仅限群主操作\n` +
            `## ⚠️ 仅限QQ v9.2.90及以上版本使用`,
    });
}
