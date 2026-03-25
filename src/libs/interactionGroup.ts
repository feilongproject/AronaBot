import axios from 'axios';
import config from '../../config/config';

const MAX_TRY = 3;

export async function awaitGroupEventId(groupRealId: string): Promise<string | null> {
    const groupId = Object.entries(config.bots[botType].groupMap).find(
        (v) => v[1] === groupRealId,
    )?.[0];
    if (!groupId) return null;

    let eventId = await redis.get(`groupLastestEventId:${botType}:${groupId}`);
    if (eventId) return eventId;
    for (let i = 0; i < MAX_TRY; i++) {
        const callInfo = await callbackButton(groupRealId);
        if (callInfo === 0) return null;

        await sleep(5000);
        eventId = await redis.get(`groupLastestEventId:${botType}:${groupId}`);
        if (eventId) return eventId;
        if (devEnv) log.debug(`awaitGroupEventId. try ${i + 1}/${MAX_TRY} no eventId`);
    }
    log.error(
        `awaitGroupEventId ${MAX_TRY}次未找到 groupLastestEventId ${groupRealId}->${groupId}`,
    );
    return null;
}

export async function callbackPushButton() {
    const callbackGroupUid = (await redis.hGet('config', `callbackGroup`)) as string;

    return callbackButton(callbackGroupUid);
}

async function callbackButton(groupRealId: string) {
    const buttonId = await redis.get(`syncGroupButtonId:${botType}:${groupRealId}`);
    const buttonData = await redis.get(`buttonData:${botType}:${groupRealId}`);
    if (!buttonId || !buttonData) return 0;
    if (devEnv) log.debug('callButton', groupRealId, buttonId, buttonData);

    return axios({
        url: config.groupPush.url,
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.groupPush.llobKey}`,
        },
        data: {
            g: groupRealId,
            a: config.groupPush.appId,
            b: buttonId,
            d: buttonData,
        },
    })
        .then((res) => res.data)
        .catch((_) => log.error(`callButton失败`));
}
