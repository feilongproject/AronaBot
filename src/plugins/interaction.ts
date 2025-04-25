import fs from "fs";
import imageSize from "image-size";
import { Button, MessageKeyboard } from "qq-bot-sdk";
import { sendToAdmin } from "../libs/common";
import { DynamicPushList } from "../types/Dynamic";
import { IMessageGROUP, MessageType } from "../libs/IMessageEx";
import config from "../../config/config";


export const commandMap: Record<string, (event: CommandArg) => Promise<any>> = {
    dynamicPush,
    echo,
};

interface CommandArg {
    eventId: string;
    groupId: string;
    btnData: string;
}


async function dynamicPush(args: CommandArg) {
    const { eventId, groupId, btnData, } = args;
    if (devEnv) log.debug("btnData:", btnData);
    if (await redis.get("devEnv") && !devEnv) return;

    const [_dynamicInfo, _pushList] = btnData.split(":");

    const [groupTrueId, imageKey] = _dynamicInfo.split(",");
    const [bUserId, dynamicId, _random] = imageKey.split(/[-\.]/);
    const pushList: DynamicPushList.PushInfo[] | undefined = _pushList ? _pushList.split(",").map(v => ({
        type: v[0] == "G" ? MessageType.GROUP : MessageType.GUILD,
        id: v.substring(1),
        name: v.substring(1),
        enable: true,
    })) : undefined;

    if (await redis.hExists(`biliMessage:idPushed:${dynamicId}`, groupTrueId) && !devEnv) { debugger; return; }
    if (await redis.exists(`biliMessage:idPushing:${dynamicId}:${groupTrueId}`) && !devEnv) { debugger; return; }
    await redis.setEx(`biliMessage:idPushing:${dynamicId}:${groupTrueId}`, 30, groupId);

    if (devEnv) {
        // log.debug(dynamicId, bUserId, pushList);
        await echo(args);
    }
    debugger;

    const msg = new IMessageGROUP({ group_id: groupId, group_openid: groupId, event_id: eventId } as any, false);
    const pushPlugin = await import("./biliDynamic");

    const imageBuffer = fs.readFileSync(`${config.imagesOut}/bili-${imageKey}`);
    const { width: imgWidth, height: imgHeight } = imageSize(imageBuffer);
    const imageUrl = cosUrl(`biliDynamic/${imageKey}`, imageBuffer.length < 4 * 1000 * 1000 ? "" : undefined);

    // await pushPlugin.dynamicPush(dynamicId, MessageType.GROUP, eventId, pushList);

    const userCard = await pushPlugin.getUserCard(bUserId);
    const userName = userCard.data.card.name;

    debugger;

    const genKeyboard = (show: string, input: string, id?: string): Button => ({
        id: id || `${show}`,
        render_data: { label: show, style: 1 },
        action: {
            type: 2,
            permission: { type: 2 },
            data: `hbupdate ${input} https://t.bilibili.com/${dynamicId}`,
        }
    });
    const hbUpdateBtn: MessageKeyboard | undefined = (bUserId == "425535005" && groupTrueId == "1041893514" && botType == "PlanaBot") ? {
        content: {
            rows: [
                { buttons: [genKeyboard("角评all", "角评 all"), genKeyboard("角评_", "角评 _")] },
                { buttons: [genKeyboard("活动jp", "活动 jp"), genKeyboard("活动g", "活动 global")] },
                { buttons: [genKeyboard("千里眼g", "千里眼 global")] },
            ],
        }
    } : undefined;
    debugger;

    const _res = await msg.sendMarkdown({
        imageUrl: imageUrl,
        params_omnipotent: [
            `${devEnv ? "dev " : ""}${userName} 更新了一条动态`,
            `[🔗https://t.bilibili`, `.com/${dynamicId}]`, `(https://t.bilibili`, `.com/${dynamicId})\r`,
            `![gui #${imgWidth}px #${imgHeight}px]`, `(${imageUrl})`,
            // `![img #px #px]`, `(${imageUrl})`,
        ],
        content: `${devEnv ? "dev " : ""}${userName} 更新了一条动态\nhttps://t.bilibili.com/${dynamicId}`,
        keyboard: hbUpdateBtn,
    }).catch(err => sendToAdmin(strFormat(err)));

    await redis.hSet(`biliMessage:idPushed:${dynamicId}`, groupTrueId, groupId);
}


async function echo(args: CommandArg) {
    const { eventId, groupId, btnData } = args;

    if (devEnv) console.log("echo.args", args);

    return await client.groupApi.postMessage(groupId, {
        msg_type: 0,
        content: btnData,
        event_id: eventId,
    } as any).then(data => {
        if (devEnv) log.debug(data.data);
        return data.data;
    }).catch(err => log.error(err));

}

export async function sendToGroupHandler(type: string, data: string, groupUid?: string) {
    const callbackGroupUid = groupUid || await redis.hGet("config", `callbackGroup`) as string;
    const groupId = Object.entries(config.bots[botType].groupMap).find(v => v[1] === callbackGroupUid)?.[0];
    if (!groupId) return;
    const eventId = await redis.get(`groupLastestEventId:${botType}:${groupId}`);
    if (!eventId) return;

    const cmdKey = commandMap[type];
    if (typeof cmdKey === 'function') return await cmdKey({
        eventId: eventId,
        groupId: groupId,
        btnData: data,
    });

}

/// -----------

export async function syncgroup(msg: IMessageGROUP) {
    const groupUid = config.bots[botType].groupMap[msg.group_id];
    if (!groupUid) return msg.sendMsgEx(`未设置群组实际群号uid`);

    const buttonKeys = `sync-${groupUid}-${Math.round(Math.random() * 10000)}`;
    await redis.set(`syncGroupButtonId:${botType}:${groupUid}`, buttonKeys);
    await redis.del(`buttonData:${botType}:${groupUid}`);

    await msg.sendMarkdown({
        params_omnipotent: [
            `检测id中, 本群uid: ${groupUid}`,
        ],
        keyboard: {
            content: {
                rows: [{
                    buttons: [{
                        id: buttonKeys,
                        render_data: { label: `btn-t1-label-${new Date().getTime()}`, visited_label: "btn-t1-label-c" },
                        action: {
                            type: 1,
                            data: "123456",
                            permission: { type: 2 },
                        },
                    }]
                }]
            },

        },
        content: `md发送失败`,
    });

    await sleep(1000 * 5);
    const buttonData = await redis.get(`buttonData:${botType}:${groupUid}`);
    if (buttonData) return msg.sendMsgEx(`已获取(5s): ${buttonData}`);

    await sleep(1000 * 5);
    const buttonData1 = await redis.get(`buttonData:${botType}:${groupUid}`);
    if (buttonData1) return msg.sendMsgEx(`已获取(10s): ${buttonData1}`);

    return msg.sendMsgEx(`获取buttonData失败`);

}

export async function callButton() {
    const callbackGroupUid = await redis.hGet("config", `callbackGroup`) as string;
    const buttonId = await redis.get(`syncGroupButtonId:${botType}:${callbackGroupUid}`);
    const buttonData = await redis.get(`buttonData:${botType}:${callbackGroupUid}`);
    if (!buttonId || !buttonData) return;

    return fetch(config.groupPush.url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.groupPush.llobKey}`,
        },
        body: JSON.stringify({
            "g": callbackGroupUid,
            "a": config.groupPush.appId,
            "b": buttonId,
            "d": buttonData,
        }),
    }).then(res => res.text()).catch(_ => log.error(`callButton失败`));
}