

export async function sendMsg(client: any, channelId: string, msgId: string, content: string) {


    await client.messageApi.postMessage(channelId, {
        content: content,
        msg_id: msgId,
        message_reference: {
            message_id: msgId,
        },
    });

}