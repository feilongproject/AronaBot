import { settingUserConfig } from "../libs/common";
import { IMessageGROUP, IMessageGUILD } from "../libs/IMessageEx";


export async function commandSetting(msg: IMessageGUILD | IMessageGROUP) {

    var optStr: string = "";
    var expCmd: string | null = null;
    const nowDay = (new Date()).setHours(0, 0, 0, 0) + 1000 * 60 * 60 * 24;
    const status = await settingUserConfig(msg.author.id, "GET", ["server", "analyzeHide"]);
    const regs = [
        { reg: /更改抽卡分析显示/, cmd: "changeAnalyzeHide" },
        { reg: /更改服务器/, cmd: "changeServer" },
        { reg: /清空今日抽卡数据/, cmd: "chearTodayData" },
        { reg: /清空全部抽卡数据/, cmd: "chearAllData" },
        { reg: /重置/, cmd: "reset" },
    ];

    for (const _reg of regs)
        if (_reg.reg.test(msg.content)) expCmd = _reg.cmd;

    switch (expCmd) {
        case "changeAnalyzeHide":
            status.analyzeHide = String(!(status.analyzeHide == "true"));
            optStr = await settingUserConfig(msg.author.id, "SET", status).then(() => {
                return `已${status.analyzeHide == "true" ? "隐藏" : "显示"}抽卡统计信息`;
            });
            break;
        case "changeServer":
            status.server = status.server == "jp" ? "global" : "jp";
            optStr = await settingUserConfig(msg.author.id, "SET", status).then(() => {
                return `已更改服务器为${status.server == "jp" ? "日服" : "国际服"}`;
            });
            break;
        case "chearTodayData":
            optStr = await redis.hSet(`data:gacha:${nowDay}`, [
                [`${msg.author.id}:global`, "0,0,0,0"],
                [`${msg.author.id}:jp`, "0,0,0,0"]
            ]).then(() => {
                return `已清空今日统计信息`;
            });
            break;
        case "chearAllData":
            optStr = await redis.hSet(`data:gacha:all`, [
                [`${msg.author.id}:global`, "0,0,0,0"],
                [`${msg.author.id}:jp`, "0,0,0,0"]
            ]).then(() => {
                return redis.hSet(`data:gacha:${nowDay}`, [
                    [`${msg.author.id}:global`, "0,0,0,0"],
                    [`${msg.author.id}:jp`, "0,0,0,0"]
                ]);
            }).then(() => {
                return "已清空全部统计信息";
            });
            break;
        case "reset":
            status.server = "global";
            status.analyzeHide = "0";
            optStr = await settingUserConfig(msg.author.id, "SET", status).then(() => {
                return redis.hSet(`data:gacha:all`, [
                    [`${msg.author.id}:global`, "0,0,0,0"],
                    [`${msg.author.id}:jp`, "0,0,0,0"]
                ]);
            }).then(() => {
                return redis.hSet(`data:gacha:${nowDay}`, [
                    [`${msg.author.id}:global`, "0,0,0,0"],
                    [`${msg.author.id}:jp`, "0,0,0,0"]
                ]);
            }).then(() => {
                return "已重置所有设置!";
            });
            break;
    }

    return msg.sendMarkdown({
        markdownNameId: "common",
        params: {
            desc1: `<@${msg.author.id}> ${optStr}`
                + `\r当前卡池选择: ${status.server == "jp" ? "日服" : "国际服"}卡池`
                + `\r抽卡分析显示状态: ${status.analyzeHide == "true" ? "隐藏" : "显示"}`
                + "\r注: 使用按钮可以快速设置",
            link1: "\u200b](https://ip.arona.schale.top/p/233",
            img1: "img #-1px #1px](  ",
            img2: "img #-1px #1px](  ",
            link2: "\u200b](https://ip.arona.schale.top/p/233",
            link3: "\u200b](https://ip.arona.schale.top/p/233",
            link4: "\u200b](https://ip.arona.schale.top/p/233",
            link5: "\u200b](https://ip.arona.schale.top/p/233",
            link6: "\u200b](https://ip.arona.schale.top/p/233",
        },
        keyboardNameId: "handbook",
        // markdown 部分

        content: (msg instanceof IMessageGROUP ? "" : `<@${msg.author.id}> `) + `${optStr}`
            + `\n当前卡池选择: ${status.server == "jp" ? "日服" : "国际服"}卡池`
            + `\n抽卡分析显示状态: ${status.analyzeHide == "true" ? "隐藏" : "显示"}`
            + `\n注: 以下子命令须在本命令后加空格使用`
            + `\n-  清空今日抽卡数据`
            + `\n-  清空全部抽卡数据`
            + `\n-  更改抽卡分析显示`
            + `\n-  更改服务器`
            + `\n-  重置`,
        // fallback 部分

    });
}
