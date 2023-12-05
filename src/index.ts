import { init } from './init';
import config from "../config/config";


init().then(() => {
    for (const eventRootType of config.bots[botType].intents) {
        log.mark(`开始监听 ${eventRootType} 事件`);
        global.ws.on(eventRootType, async (data: IntentMessage.EventRespose<any>) => {
            data.eventRootType = eventRootType;
            return import("./eventRec").then(e => e.eventRec(data));
        });
    }
});