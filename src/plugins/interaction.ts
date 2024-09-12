import fs from "fs";
import imageSize from "image-size";
import { Button, MessageKeyboard } from "qq-bot-sdk";
import { IMessageGROUP, MessageType } from "../libs/IMessageEx";
import { DynamicPushList } from "../types/Dynamic";
import config from "../../config/config";
import { sendToAdmin } from "../libs/common";


export const commandMap: Record<string, (event: IntentMessage.INTERACTION) => Promise<void>> = {
    dynamicPush,
    echo,
}

function convertEvent(event: IntentMessage.INTERACTION) {
    return {
        eventId: event.eventId,
        groupId: event.msg.group_openid,
        btnData: event.msg.data.resolved.button_data,
    };
}


async function dynamicPush(event: IntentMessage.INTERACTION) {
    const { eventId, groupId, btnData, } = convertEvent(event);
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
        await echo(event);
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
    }).catch(err => sendToAdmin(stringifyFormat(err)));

    await redis.hSet(`biliMessage:idPushed:${dynamicId}`, groupTrueId, groupId);
}


async function echo(event: IntentMessage.INTERACTION) {

    const { groupId, btnData, } = convertEvent(event);

    if (devEnv) console.log("postMessage", btnData);

    await client.groupApi.postMessage(groupId, {
        msg_type: 0,
        content: btnData,
        event_id: event.eventId,
    } as any).then(data => {
        if (devEnv) log.debug(data.data);
    }).catch(err => log.error(err));

}