import { IGuild, IMessage, MessageAPI, MessageAttachment, OpenAPI, WebsocketClient } from "qq-guild-bot"

export { }


declare global {

  var client: OpenAPI;
  var ws: WebsocketClient;
  var meId: string;
  var saveGuildsTree: SaveGuild[];

  interface IntentMessage {
    eventType: string,
    eventId: string,
    msg: IMessage,
  }

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
