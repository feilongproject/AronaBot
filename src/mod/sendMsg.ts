import FormData from 'form-data';
import fetch, { Headers } from 'node-fetch';
import { IMessage } from 'qq-guild-bot';
import fs from 'fs';
import config from '../../data/config.json';
import log from './logger';


export function sendMsg(client: any, channelId: string, msgId: string, content: string) {


    client.messageApi.postMessage(channelId, {
        content: content,
        msg_id: msgId,
        message_reference: {
            message_id: msgId,
        },
    });

}

export async function sendImage(msg: IMessage, picName: string,) {

    picName = picName?.startsWith("/") ? picName : `${config.picPath.out}/${picName}`;
    log.debug(`uploading ${picName}`);

    //picName = "/root/RemoteDir/qbot/BAbot/dist/1656612431035.png";

    var picData = fs.createReadStream(picName);

    //log.debug(picData);

    var formdata = new FormData();
    formdata.append("msg_id", msg.id);
    //formdata.append("content", "123456")
    formdata.append("file_image", picData);

    fetch(`https://api.sgroup.qq.com/channels/${msg.channel_id}/messages`, {
        method: "POST",
        headers: {
            "Content-Type": formdata.getHeaders()["content-type"],
            "Authorization": `Bot ${config.initConfig.appID}.${config.initConfig.token}`
        },
        body: formdata

    }).then(res => {
        return res.json();
    }).then(body => {
        if (body.code)
            throw new Error(body);
    }).catch(error => {
        log.error(error);
    })

}