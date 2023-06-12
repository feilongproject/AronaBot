import { init } from './init';

init().then(() => {

    global.ws.on("GUILD_MESSAGES", async (data: IntentMessage.GUILD_MESSAGES) => {
        data.eventRootType = "GUILD_MESSAGES";
        return import("./eventRec").then(e => e.eventRec(data));
    });

    global.ws.on("DIRECT_MESSAGE", async (data: IntentMessage.DIRECT_MESSAGE) => {
        data.eventRootType = "DIRECT_MESSAGE";
        return import("./eventRec").then(e => e.eventRec(data));
    });

    global.ws.on("GUILDS", async (data) => {
        data.eventRootType = "GUILDS";
        return import("./eventRec").then(e => e.eventRec(data));
    });

    global.ws.on("FORUMS_EVENT", async (data) => {
        data.eventRootType = "FORUMS_EVENT";
        return import("./eventRec").then(e => e.eventRec(data));
    });

    global.ws.on("GUILD_MEMBERS", async (data: IntentMessage.GUILD_MEMBERS) => {
        data.eventRootType = "GUILD_MEMBERS";
        return import("./eventRec").then(e => e.eventRec(data));
    });

});