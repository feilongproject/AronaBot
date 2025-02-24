import lodash from "lodash";
import { IMessageGROUP } from "../libs/IMessageEx";
import config from "../../config/config";


const appID = config.bots[botType].appID;

export async function wifuToday(msg: IMessageGROUP) {

    const nowDay = (new Date()).setHours(0, 0, 0, 0) / 1000;
    const nextDay = nowDay + 24 * 60 * 60;
    const todayKey = `wifuToday:${nowDay}:${msg.group_id}`;
    if (!await redis.exists(todayKey)) {
        await redis.hSet(todayKey, "next", nextDay);
        await redis.expireAt(todayKey, nextDay);
    }

    const usedUser: { aid: string; }[] = await mariadb.query(`
    SELECT gm.*
    FROM groupMessage gm
    JOIN (
        SELECT aid,MAX(ts_utc8) AS latest_ts
        FROM groupMessage 
        WHERE gid = (?)
            AND ts_utc8 >= NOW() - INTERVAL 3 DAY
        GROUP BY aid 
    ) AS tmp
    ON gm.aid=tmp.aid AND gm.ts_utc8=tmp.latest_ts
    ORDER BY gm.ts_utc8 DESC;
    `, [msg.group_id]);

    const todayMembers = await redis.hGetAll(todayKey);

    let pairUser = todayMembers[msg.author.id];
    if (!pairUser) {
        if (usedUser.length <= 1) return msg.sendMsgEx(`当前群内潜在老婆不足, 请召唤其他群友使用bot任意功能后重新再试`);

        const todayUse: string[] = Object.keys(todayMembers); // 找出今日结婚的
        const notPair = usedUser.map(v => v.aid).filter(v => !todayUse.includes(v) && v != msg.author.id); // 看看有没有单身的

        if (!notPair.length) return msg.sendMsgEx(`今天的老婆被别人全部抢走了...召唤群友使用bot以加入老婆库！`);
        pairUser = lodash.sample(notPair.slice(0, 10)) || notPair[0]; // 恭喜这位群友喜结连理
    }

    if (!pairUser) return msg.sendMsgEx(`程序似乎出了点问题，请稍后重试`);

    await msg.sendMarkdown({
        content: `<!@${pairUser}>`,
        params_omnipotent: [
            `<@${msg.author.id}>\r`,
            `您今天的群友老婆是：\r`,
            msg.content.includes("at") ? `<@${pairUser}>\r` : "",
            `![img #130px #130px]`,
            `(https://q.qlogo.cn/qqapp/${appID}/${pairUser}/100)`,
        ],
        keyboard: {
            content: {
                rows: [{
                    buttons: [
                        {
                            id: `wifu-me`,
                            render_data: {
                                label: "看看我的",
                                style: 1
                            },
                            action: {
                                type: 2,
                                permission: {
                                    type: 2
                                },
                                data: `今日老婆`
                            }
                        }, {
                            id: `wifu-me-at`,
                            render_data: {
                                label: "看看我的(@一下她)",
                                style: 1
                            },
                            action: {
                                type: 2,
                                permission: {
                                    type: 2
                                },
                                data: `今日老婆 at`
                            }
                        },
                    ]
                }],
            }
        }
    });

    await redis.hSet(todayKey, [
        [msg.author.id, pairUser,],
        [pairUser, msg.author.id,],
    ]);

}


export async function wifuDelete(msg: IMessageGROUP) {

    const nowDay = (new Date()).setHours(0, 0, 0, 0) / 1000;
    // const nextDay = nowDay + 24 * 60 * 60;
    const todayKey = `wifuToday:${nowDay}:${msg.group_id}`;


    const pair = await redis.hGet(todayKey, msg.author.id);
    if (!pair) return msg.sendMsgEx(`今日还没有结婚呢...要不要和群友结个婚试试？`);

    await redis.hDel(todayKey, [msg.author.id, pair]);

    return msg.sendMsgEx(`离婚了喵......`);
}