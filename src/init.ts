import { createOpenAPI, createWebsocket, OpenAPI } from 'qq-guild-bot';
import { Databaser } from './mod/databaser';
import log from './mod/logger';
import config from '../data/config.json';

export async function init() {

    global.client = createOpenAPI(config.initConfig);
    global.ws = createWebsocket(config.initConfig as any);

    global.client.meApi.me().then(res => {
        global.meId = res.data.id;
    });

    return new Databaser({
        host: "127.0.0.1",
        port: 13306,
        user: "root",
        password: "P@ssWord14789",
        database: "AronaBot",
        connectTimeout: 5,
    }, config.initConfig);
}

export async function buildTree() {
    global.saveGuildsTree = [];
    global.client.meApi.meGuilds().then(guilds => {

        for (const guild of guilds.data) {
            log.info(`${guild.name}(${guild.id})`);
            var _guild: SaveChannel[] = [];
            //log.info(guild.id);
            //log.info(guild.channels);
            global.client.channelApi.channels(guild.id).then(channels => {
                for (const channel of channels.data) {
                    if (channel.name != "") {
                        log.info(`${guild.name}(${guild.id})-${channel.name}(${channel.id})-father:${channel.parent_id}`);
                    }
                    _guild.push({ name: channel.name, id: channel.id });
                }
                global.saveGuildsTree.push({ name: guild.name, id: guild.id, channel: _guild });
            });
        }


    });
}