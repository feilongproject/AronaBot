import { createOpenAPI, createWebsocket, OpenAPI } from 'qq-guild-bot';
import log from './mod/logger';

export function init(config: any) {

    var saveGuildsTree: SaveGuild[] = [];

    var client = createOpenAPI(config), ws = createWebsocket(config);

    return client.meApi.me().then(res => {
        var meId = res.data.id;

        return client.meApi.meGuilds().then(guilds => {

            guilds.data.forEach(guild => {
                log.info(`${guild.name}(${guild.id})`);
                var _guild: SaveChannel[] = [];
                //log.info(guild.id);
                //log.info(guild.channels);
                client.channelApi.channels(guild.id).then(channels => {
                    channels.data.forEach((channel => {
                        if (channel.name != "") {
                            log.info(`${guild.name}(${guild.id})-${channel.name}(${channel.id})-father:${channel.parent_id}`);
                        }
                        _guild.push({ name: channel.name, id: channel.id });
                    }));

                    saveGuildsTree.push({ name: guild.name, id: guild.id, channel: _guild });
                });



            });
            return { client, ws, saveGuildsTree, meId };
        });
    });

}