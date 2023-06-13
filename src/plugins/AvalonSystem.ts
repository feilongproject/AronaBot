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

export async function addWatchList(msg: IMessageGUILD | IMessageDIRECT) {
    if (unauthorized(msg)) return;
    const reg = /^watch\s*(\d*)$/.exec(msg.content)!;
    const watchUser = reg[1];
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${watchUser}`);

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

export async function unWatchList(msg: IMessageGUILD | IMessageGUILD) {
    if (unauthorized(msg)) return;
    const reg = /^unwatch\s*(\d*)$/.exec(msg.content)!;
    const watchUser = reg[1];
    const watchChannel = await redis.hGet(`AvalonSystem`, `watchChannel:${watchUser}`);

    return redis.hDel(`AvalonSystem`, `watchChannel:${watchUser}`).then(status => {
        // saveGuildsTree["13281105882878427654"].channels
        if (!watchChannel) return msg.sendMsgEx({
            content: `数据库中未找到监控室子频道` +
                `\nstatus: ${status}`,
        });
        return client.channelApi.deleteChannel(watchChannel).then(res => msg.sendMsgEx({
            content: `已删除监控室子频道` +
                `\nstatus: ${status}` +
                `\ndata: ${JSON.stringify(res.data)}`
        }));
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({
            content: `发送消息时出现了错误`
                + `\n${JSON.stringify(err).replaceAll(".", " .")}`,
        });
    });

}

// export async function listWatchList(msg:IMessageGUILD|IMessageDIRECT) {
//     if(unauthorized(msg))return;

// }

function unauthorized(msg: IMessageGUILD | IMessageDIRECT) {
    return !((msg.messageType == "DIRECT" && adminId.includes(msg.author.id)) || msg.channel_id == "519695851");
}