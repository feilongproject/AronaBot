import { createOpenAPI, createWebsocket } from 'qq-guild-bot';
import log from './mod/logger';

export async function init(config: any) {

    var saveGuilds: SaveGuild[] = [];

    var client = createOpenAPI(config);
    var ws = createWebsocket(config);

    var meId = await (await client.meApi.me()).data.id
    var guilds = await client.meApi.meGuilds();
    //log.info(guilds.data);

    guilds.data.forEach(async (guild) => {
        log.info(`${guild.name}(${guild.id})`);
        var _guild: SaveChannel[] = [];
        //log.info(guild.id);
        //log.info(guild.channels);
        var channels = await client.channelApi.channels(guild.id);
        //log.info(channels.data);
        channels.data.forEach((channel => {
            if (channel.name != "") {
                log.debug(`${guild.name}(${guild.id})-${channel.name}(${channel.id})-father:${channel.parent_id}`);
            }
            _guild.push({ name: channel.name, id: channel.id });

        }))

        saveGuilds.push({ name: guild.name, id: guild.id, channel: _guild });

    });

    return { client, ws, saveGuilds, meId };
}