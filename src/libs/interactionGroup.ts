import axios from 'axios';
import config from '../../config/config';

export async function awaitGroupEventId(groupRealId: string): Promise<string | null> {
    const groupId = Object.entries(config.bots[botType].groupMap).find(
        (v) => v[1] === groupRealId,
    )?.[0];
    if (!groupId) return null;

    let eventId = await redis.get(`groupLastestEventId:${botType}:${groupId}`);
    if (eventId) return eventId;

    // 等候5s获取id
    await callbackButton(groupRealId);
    await sleep(5000);
    eventId = await redis.get(`groupLastestEventId:${botType}:${groupId}`);
    if (eventId) return eventId;
    if (devEnv) log.debug('awaitGroupEventId. 5s no eventId');

    // 等候5s获取id
    await callbackButton(groupRealId);
    await sleep(5000);
    eventId = await redis.get(`groupLastestEventId:${botType}:${groupId}`);
    if (eventId) return eventId;
    if (devEnv) log.debug('awaitGroupEventId. 10s no eventId');

    // 等候5s获取id
    await callbackButton(groupRealId);
    await sleep(5000);
    eventId = await redis.get(`groupLastestEventId:${botType}:${groupId}`);
    if (eventId) return eventId;
    if (devEnv) log.debug('awaitGroupEventId. 15s no eventId');

    log.error(`awaitGroupEventId 15s 未找到 groupLastestEventId`);
    return null;
}

export async function callbackPushButton() {
    const callbackGroupUid = (await redis.hGet('config', `callbackGroup`)) as string;

    return callbackButton(callbackGroupUid);
}

async function callbackButton(groupRealId: string) {
    const buttonId = await redis.get(`syncGroupButtonId:${botType}:${groupRealId}`);
    const buttonData = await redis.get(`buttonData:${botType}:${groupRealId}`);
    if (!buttonId || !buttonData) return;
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
