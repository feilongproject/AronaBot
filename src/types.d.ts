import { IGuild, IMessage, MessageAPI, MessageAttachment } from "qq-guild-bot"

export { }


declare global {

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

  interface IMessageEx {
    guild_name?: string,
    channel_name?: string,
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
