import { IMessageGUILD, IMessageDIRECT } from "../libs/IMessageEx";


export async function avalonSystem(msg: IMessageGUILD) {

    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${msg.author.id}`);
    if (!watchChannel) return;

    return msg.sendMsgEx({
        content: `来源子频道: ${msg.channelName}` +
            `\n来源子频道id: ${msg.channel_id}` +
            `\n内容${msg._atta}: \n` +
            msg.content.replaceAll(".", ". "),
        channelId: watchChannel,
    });
}

export async function addWatchList(msg: IMessageDIRECT) {
    if (!adminId.includes(msg.author.id)) return;
    const reg = /^watch\s*(\d*)$/.exec(msg.content)!;
    const watchUser = reg[1];
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${msg.author.id}`)

    return client.guildApi.guildMember("7487571598174764531", watchUser).then(res => {
        const { data } = res;
        if (watchChannel) return msg.sendMsgEx({
            content: `阿瓦隆监控列表已存在` +
                `\nnick: ${data.nick}` +
                `\nusername: ${data.user.username}` +
                `\nid: ${data.user.id}`,
        });
        return client.channelApi.postChannel("13281105882878427654", {
            name: `${watchUser}-${data.nick}`,
            type: 0,
            parent_id: "535627915",
            position: 0,
        }).then(r => redis.hSet(`AvalonSystem`, `watchChannel:${data.user.id}`, r.data.id)).then(() => msg.sendMsgEx({
            content: `已添加用户到阿瓦隆监控列表` +
                `\nnick: ${data.nick}` +
                `\nusername: ${data.user.username}` +
                `\nid: ${data.user.id}`,
        }));
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({
            content: `发送消息时出现了错误`
                + `\n${JSON.stringify(err).replaceAll(".", " .")}`,
        });
    });
}