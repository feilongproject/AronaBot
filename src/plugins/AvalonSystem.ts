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

export async function meituChannel(msg: IMessageDIRECT) {
    if (devEnv) return;
    if (msg.content == "当前版本不支持查看，请升级QQ版本") return;
    if (msg.content == "当前版本不支持该消息类型，请使用最新版本手机QQ查看") return;
    if (msg.attachments) return;
    if (msg.member && msg.member.roles && (msg.member.roles.includes("2") || msg.member.roles.includes("4") || msg.member.roles.includes("5"))) return;

    const sendToChannel = await redis.hGet("mute:sendChannel", msg.guild_id);

    return msg.sendMsgEx({
        content: `发现无图文字` +
            `\n用户: ${msg.author.username}(${msg.author.id})` +
            `\n内容: ${msg.content}` +
            `\n原因: 无图文字`,
        guildId: await global.redis.hGet(`directUid->Gid`, adminId[0]),
        sendType: "DIRECT",
    }).then(() => client.muteApi.muteMember(msg.guild_id, msg.author.id, { seconds: String(1 * 60 * 60) })
    ).then(() => client.messageApi.deleteMessage(msg.channel_id, msg.id)
    ).then(() => sendToChannel ? msg.sendMsgEx({
        content: `<@${msg.author.id}>(id: ${msg.author.id})` +
            `\n禁言1h` +
            `\n原因: 无配图文字` +
            `\n注意: 该消息由bot自动发送，如有异议联系<@${adminId[0]}>`,
        channelId: sendToChannel,
        sendType: "GUILD",
    }) : undefined
    ).catch(err => {
        log.error(err);
    });
}
