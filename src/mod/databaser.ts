import { createOpenAPI, createWebsocket, OpenAPI } from "qq-guild-bot";
import mariadb from "mariadb";
import fs from "fs";
import FormData from 'form-data';
import fetch from "node-fetch";
import log from "./logger";
import { Messager } from "./messager";
import config from '../../data/config.json';

export class Databaser {


    saveGuildsTree: SaveGuild[] = [];
    dbPool;
    conn!: mariadb.PoolConnection;
    client: OpenAPI;
    ws;
    meId!: string;
    //sendUsers: SendChannel[] = [];
    //configPath: string;


    constructor(databaseConfig: DatabaseConfig, botConfig: any) {

        this.dbPool = mariadb.createPool(databaseConfig);
        this.dbPool.getConnection().then(conn => {
            this.conn = conn;
        });
        //this.configPath = config.serveUserConfigPath;
        this.client = createOpenAPI(botConfig);
        this.ws = createWebsocket(botConfig);

        this.client.meApi.me().then(res => {
            this.meId = res.data.id;
        });
        this.buildTree();
    }

    buildTree() {
        this.client.meApi.meGuilds().then(guilds => {
            guilds.data.forEach(guild => {
                log.info(`${guild.name}(${guild.id})`);
                var _guild: SaveChannel[] = [];
                //log.info(guild.id);
                //log.info(guild.channels);
                this.client.channelApi.channels(guild.id).then(channels => {
                    channels.data.forEach((channel => {
                        if (channel.name != "") {
                            log.info(`${guild.name}(${guild.id})-${channel.name}(${channel.id})-father:${channel.parent_id}`);
                        }
                        _guild.push({ name: channel.name, id: channel.id });
                    }));

                    this.saveGuildsTree.push({ name: guild.name, id: guild.id, channel: _guild });
                });
            });
        });
    }

    sendMsg(messager: Messager, content: string) {
        this.client.messageApi.postMessage(messager.msg.channel_id, {
            content: content,
            msg_id: messager.msg.id,
            message_reference: {
                message_id: messager.msg.id,
            },
        });
    }

    sendImage(messager: Messager, picName: string,) {

        picName = picName?.startsWith("/") ? picName : `${config.picPath.out}/${picName}`;
        log.debug(`uploading ${picName}`);

        //picName = "/root/RemoteDir/qbot/BAbot/dist/1656612431035.png";

        var picData = fs.createReadStream(picName);

        //log.debug(picData);

        var formdata = new FormData();
        formdata.append("msg_id", messager.msg.id);
        //formdata.append("content", "123456")
        formdata.append("file_image", picData);

        fetch(`https://api.sgroup.qq.com/channels/${messager.msg.channel_id}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": formdata.getHeaders()["content-type"],
                "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`
            },
            body: formdata

        }).then(res => {
            return res.json();
        }).then(body => {
            if (body.code)
                throw new Error(body);
        }).catch(error => {
            log.error(error);
        })

    }


}


interface DatabaseConfig {

}