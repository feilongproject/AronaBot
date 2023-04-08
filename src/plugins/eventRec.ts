import { pushToDB } from "../libs/common";

export async function eventRec(event: IntentMessage.GUILD_MEMBERS) {
    const { msg } = event;
    const { user } = msg;
    return await pushToDB("GUILD_MEMBERS", {
        type: event.eventType,
        eId: event.eventId,
        aId: user.id,
        aAvatar: user.avatar,
        aName: user.username,
        nick: msg.nick,
        gid: msg.guild_id,
        ts: msg.joined_at,
    });
}