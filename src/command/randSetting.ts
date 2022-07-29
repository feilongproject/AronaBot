import { findChannel } from "../mod/findChannel";
import log from "../mod/logger";
import { Messager } from "../mod/messager";
import { Databaser, DatabaseUserPoolSetting } from "../mod/databaser";





export async function commandRandSetting(pusher: Databaser, messager: Messager, opts: string[]): Promise<void> {

    if (findChannel(pusher.saveGuildsTree, messager.msg.channel_id) || messager.msg.guildName == "QQ频道机器人测试频道") {
        pusher.databaseSearch("userPoolSetting", "userId", messager.msg.author.id).then((data: DatabaseUserPoolSetting[]) => {
            if (data[0]?.userId.toString() == messager.msg.author.id) {

                var setting = data[0];
                switch (opts[1]) {
                    case "重置":
                        restartSetting(pusher, messager, true);
                        break;
                    case "清空今日":
                    case "清空今日统计":
                    case "清空今日统计信息":
                        setting.randedToday = { star1: 0, star2: 0, star3: 0 };
                        pusher.databasePushPoolSetting(setting, true).then(() => {
                            pusher.sendMsg(messager, `已清空今日统计`);
                        }).catch(err => {
                            log.error(err);
                        });
                        break;
                    case "清空全部":
                    case "清空全部统计":
                    case "清空全部统计信息":
                        setting.randedToday = { star1: 0, star2: 0, star3: 0 };
                        setting.randedAll = { star1: 0, star2: 0, star3: 0 };
                        pusher.databasePushPoolSetting(setting, true).then(() => {
                            pusher.sendMsg(messager, `已清空全部统计`);
                        }).catch(err => {
                            log.error(err);
                        });
                        break;
                    case "隐藏":
                    case "隐藏统计":
                    case "隐藏统计信息":
                        if (opts[2]) {
                            switch (opts[2]) {
                                case "是":
                                case "开":
                                case "开启":
                                    setting.hide = true;
                                    break;
                                case "否":
                                case "关":
                                case "关闭":
                                    setting.hide = false;
                                    break;
                            }

                        } else {
                            setting.hide = true;
                        }
                        pusher.databasePushPoolSetting(setting, true).then(() => {
                            pusher.sendMsg(messager, `已${setting.hide ? `开启` : `关闭`}隐藏统计信息`);
                        }).catch(err => {
                            log.error(err);
                        });

                        break;
                    case "帮助":
                    case "帮助界面":
                        pusher.sendMsg(messager,
                            `抽卡设置 - 帮助界面\n` +
                            `========================\n` +
                            `（以下命令必须@机器人后才能使用）\n\n` +
                            `指令：/抽卡设置 重置\n` +
                            `介绍：重置所有卡池设置到默认（选择卡池、统计信息等）\n\n` +
                            `指令：/抽卡设置 清空今日\n` +
                            `介绍：清空今日抽卡统计信息\n\n` +
                            `指令：/抽卡设置 清空全部\n` +
                            `介绍：清空全部抽卡统计信息\n\n` +
                            `指令：/抽卡设置 隐藏 开/关\n` +
                            `介绍：选择是否隐藏抽卡统计信息` +
                            ``);
                        break;
                    default:
                        pusher.sendMsg(messager, `未知抽卡设置选项，使用"/抽卡设置 帮助"获取指令列表`);
                        break;
                }
            } else {
                if (opts[1] == "重置") {
                    restartSetting(pusher, messager, false);
                } else {
                    pusher.sendMsg(messager, `未找到用户设置，请@bot后输入"/抽卡设置 重置"开始初始化设置\n（如果之后要恢复默认也可使用该命令）`);
                }
            }

        });

    } else {
        log.warn(`unAuth channel id:${messager.msg.channel_id}|||user:${messager.msg.author.username}`);
        pusher.sendMsg(messager, `当前子频道未授权,请在隔壁使用`);
    }


}

async function restartSetting(pusher: Databaser, messager: Messager, del: boolean) {
    if (del) {
        //log.debug(`DELETE FROM userPoolSetting WHERE userPoolSetting.userId = ${messager.msg.author.id}`);
        await pusher.conn.query(`DELETE FROM userPoolSetting WHERE userPoolSetting.userId = ${messager.msg.author.id}`).catch(err => {
            log.error(err);
        });
    }

    pusher.databasePushPoolSetting({
        userId: BigInt(messager.msg.author.id),
        userName: messager.msg.author.username,
        selectPoolId: 0,
        randedToday: {
            star1: 0,
            star2: 0,
            star3: 0,
        },
        randedTodayTs: new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
        randedAll: {
            star1: 0,
            star2: 0,
            star3: 0,
        },
        hide: false,
    }, false).then(() => {
        pusher.sendMsg(messager, `已重置设置（这是一个不可撤回的操作！）`);
    }).catch(err => {
        log.error(err);
    });
}