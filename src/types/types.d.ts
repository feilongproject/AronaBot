import log4js from "log4js";
import {
  IGuild,
  IMessage,
  MessageAPI,
  MessageAttachment,
  OpenAPI,
  WebsocketClient
} from "qq-guild-bot";
//import { Browser } from "puppeteer";
import { RedisClientType } from "@redis/client";


declare global {

  var devEnv: boolean;
  var adminId: string;
  var log: log4js.Logger;
  var _path: string;
  var client: OpenAPI;
  var ws: WebsocketClient;
  var meId: string;
  var redis: RedisClientType;
  //var browser: Browser | null;
  var botStatus: {
    startTime: Date;
    msgSendNum: number;
    imageRenderNum: number;
  }

  interface IntentMessage {
    eventType:
    "MESSAGE_CREATE" | "MESSAGE_DELETE" |
    "AT_MESSAGE_CREATE" | "PUBLIC_MESSAGE_DELETE" |
    "DIRECT_MESSAGE_CREATE" | "DIRECT_MESSAGE_DELETE" |
    "GUILD_MEMBER_REMOVE" | "GUILD_MEMBER_ADD" | "GUILD_MEMBER_UPDATE",
    eventId: string,
    msg: IMessage & GUILD_MEMBER & DirectMessage,
  }

  interface GUILD_MEMBER {
    guild_id: string;
    joined_at: string;
    nick: string;
    op_user_id: string;
    roles?: string[];
    user: {
      avatar: string;
      bot: boolean;
      id: string;
      username: string;
    };
  }

  interface DirectMessage {
    direct_message: boolean;
    src_guild_id: string;
  }

  var saveGuildsTree: SaveGuild[];
  interface SaveGuild {
    name: string,
    id: string,
    channel: SaveChannel[],
  }
  interface SaveChannel {
    name: string,
    id: string,
  }

  interface Member {
    id: string,
    name: string,
  }

  interface Character {
    source: string,
    chineseName: string,
    fileName: string,
  }
}
