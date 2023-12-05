import { init } from './init';
import config from "../config/config";


init().then(() => {
    for (const eventRootType of config.bots[botType].intents) {
        global.ws.on(eventRootType, async (data: IntentMessage.GUILD_MESSAGES) => {
            data.eventRootType = eventRootType;
            return import("./eventRec").then(e => e.eventRec(data));
        });
    }
});