import { createOpenAPI, createWebsocket, OpenAPI } from 'qq-guild-bot';
import { Databaser } from './mod/databaser';
import log from './mod/logger';
import config from '../data/config.json';

export async function init() {
    return new Databaser({
        host: "127.0.0.1",
        port: 13306,
        user: "root",
        password: "P@ssWord14789",
        database: "AronaBot",
        connectTimeout: 5,
    }, config.initConfig);
}