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

    async sendMsg(messager: Messager, content: string) {
        return this.client.messageApi.postMessage(messager.msg.channel_id, {
            content: content,
            msg_id: messager.msg.id,
            message_reference: {
                message_id: messager.msg.id,
            },
        }).then(res => {
            return res.data;
        });
    }

    async sendImage(messager: Messager, picName: string, content?: string, retry?: boolean) {

        picName = picName?.startsWith("/") ? picName : `${config.picPath.out}/${picName}`;
        log.debug(`uploading ${picName}`);

        var picData = fs.createReadStream(picName);

        //log.debug(picData);

        var formdata = new FormData();
        formdata.append("msg_id", messager.msg.id);
        if (content)
            formdata.append("content", content);
        formdata.append("file_image", picData);

        return fetch(`https://api.sgroup.qq.com/channels/${messager.msg.channel_id}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": formdata.getHeaders()["content-type"],
                "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`,
            },
            body: formdata,
        }).then(res => {
            return res.json();
        }).then(body => {
            if (body.code)
                throw new Error(body);
        }).catch(error => {
            log.error(error);
        })

    }

    databasePushPoolSetting(data: DatabaseUserPoolSetting, update: boolean) {
        if (update) {
            //UPDATE ${type} SET timestamp=?,channelId=?,channelName=? WHERE token=?;
            return this.conn.query(`UPDATE userPoolSetting SET selectPoolId=?,randedToday=?,randedTodayTs=?,randedAll=?,hide=? WHERE userId=?`, [
                data.selectPoolId, data.randedToday, data.randedTodayTs, data.randedAll, data.hide, data.userId,
            ]);
        } else {
            return this.databasePush(
                "userPoolSetting",
                ["userName", "userId", "selectPoolId", "randedToday", "randedAll", "hide"],
                [data.userName, data.userId, data.selectPoolId, data.randedToday, data.randedAll, data.hide],
            );
        }
    }

    databasePush(table: string, key: string[], value: any[]) {
        var keyStr = `(`;
        key.forEach(v => { keyStr += `${v},`; });
        keyStr = `${keyStr.slice(0, -1)}) VALUES (`;
        key.forEach(v => { keyStr += `?,`; });
        keyStr = `${keyStr.slice(0, -1)})`;

        return this.conn.query(`INSERT INTO ${table} ${keyStr}`, value);
    }

    /**
     * 
     * @param table 数据表
     * @param key 数据键
     * @param value 数据值
     * @returns 返回查询结果
     */
    databaseSearch(table: string, key: string, value: string) {
        //log.debug("searching");

        //log.debug(`SELECT * FROM ${table} WHERE ${key} = ${value}`);
        return this.conn.query(`SELECT * FROM ${table} WHERE ${key} = ?`, [
            value,
        ]);

    }

}


interface DatabaseConfig {

}

export interface DatabaseUserPoolSetting {
    userName: string;
    userId: string;
    selectPoolId: number;
    randedToday: Randed;
    randedTodayTs: number;
    randedAll: Randed;
    hide: boolean;
}

interface Randed {
    star1: number,
    star2: number,
    star3: number,
}