import { IMessageEx } from "../libs/IMessageEx";


export async function meituChannel(msg: IMessageEx) {
    //log.debug(msg.content, msg.attachments);

    if (!msg.attachments) {

        msg.sendMsgEx({
            content: `频道（${msg.guild_name}->${msg.channel_name}）中发现违规内容` +
                `\n用户：${msg.author.username}` +
                `\n用户id：${msg.author.id}` +
                `\n频道：${msg.guild_name}` +
                `\n子频道：${msg.channel_name}` +
                `\n内容：${msg.content}` +
                `\n原因：无配图文字`,
            guildId: await global.redis.hGet(`directGuildId`, adminId),
            sendType: "DIRECT",
        }).then(() => {

            // e.g. 禁言 100 秒
            // let { data } = await client.muteApi.muteMember("xxxxxx", "xxxxxx", { seconds:"100" });
            // e.g. 禁言到 2022-01-08 10:29:11
            // let { data } = await client.muteApi.muteMember("xxxxxx", "xxxxxx", { timeTo:"1641608951" });
            // e.g. 解除禁言
            // let { data } = await client.muteApi.muteMember("xxxxxx", "xxxxxx", { timeTo:"0" });
            // e.g. 解除禁言
            // let { data } = await client.muteApi.muteMember("xxxxxx", "xxxxxx", { seconds:"0" });
        }).catch(err => {
            log.error(err);
        });
    }
}