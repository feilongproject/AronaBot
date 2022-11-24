import { IMessageEx } from "../libs/IMessageEx";


export async function meituChannel(msg: IMessageEx) {

    if (msg.content == "当前版本不支持查看，请升级QQ版本") return;
    if (msg.attachments) return;
    if (msg.member && msg.member.roles && (msg.member.roles.includes("2") || msg.member.roles.includes("4") || msg.member.roles.includes("5"))) return;

    const sendToChannel = await redis.hGet("muteSendChannel", msg.guild_id);

    return msg.sendMsgEx({
        content: `发现无图文字` +
            `\n用户：${msg.author.username}(${msg.author.id})` +
            `\n内容：${msg.content}` +
            `\n原因：无图文字`,
        guildId: await global.redis.hGet(`directUid->Gid`, adminId[0]),
        sendType: "DIRECT",
    }).then(() => {
        return client.muteApi.muteMember(msg.guild_id, msg.author.id, { seconds: String(1 * 60 * 60) });
    }).then(() => {
        return client.messageApi.deleteMessage(msg.channel_id, msg.id);
    }).then(() => {
        if (!sendToChannel) return;
        return msg.sendMsgEx({
            content: `<@${msg.author.id}>(id:${msg.author.id})` +
                `\n禁言1h` +
                `\n原因：无配图文字` +
                `\n注意：该消息由bot自动发送，如有异议联系<@${adminId[0]}>`,
            channelId: sendToChannel,
        });
    }).catch(err => {
        log.error(err);
    });
}