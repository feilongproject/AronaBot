import fs from 'fs';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { IMessageGROUP } from '../libs/IMessageEx';
import { getForwardMessage, uploadGroupFile } from '../libs/onebot';
import config from '../../config/config';

export async function saveForward(msg: IMessageGROUP) {
    if (msg.isOffical) return msg.sendMsgEx(`请不要@bot进行使用`);

    const replyMsgId = /^\[CQ:reply,id=(?<mid>\d+)\]转存图片$/.exec(msg.content)?.groups?.mid;

    if (!replyMsgId) return msg.sendMsgEx('无法获取replyMsgId');
    await msg.sendMsgEx(`已获得replyMsgId: ${replyMsgId}`);

    const forwardInfo = await getForwardMessage(replyMsgId);

    const reMessage = [
        {
            reId: replyMsgId,
            reContent: forwardInfo.messages.map((v) => v.content).flat(),
        },
    ];
    const reForwardMsg = [] as { id: string }[];
    const fileList = [] as { url: string; name: string }[];
    while (true) {
        reForwardMsg.length = 0;

        // 开始循环遍历转发与图片消息
        for (const { reId, reContent } of reMessage) {
            for (const [mIv, mContent] of reContent.entries()) {
                if (mContent.type == 'image') {
                    fileList.push({
                        url: mContent.data.url,
                        name: `${reId}-${mIv}-${mContent.data.file}`,
                    });
                }
                if (mContent.type == 'forward') {
                    reForwardMsg.push({ id: mContent.data.id });
                }
            }
        }
        debugger;
        reMessage.length = 0;
        // 结束正常循环并清空所有消息

        // 如果存在转发消息则获取内部消息到reMessage
        for (const _reForwardMsg of reForwardMsg) {
            const _reMessage = await getForwardMessage(_reForwardMsg.id);
            reMessage.push({
                reId: _reForwardMsg.id,
                reContent: _reMessage.messages.map((v) => v.content).flat(),
            });
        }

        // 结束循环遍历，没找到转发消息退出
        if (reForwardMsg.length <= 0) break;
    }

    if (!fileList.length) return msg.sendMsgEx(`转发消息中不存在图片类型消息`);

    const fileData = await Promise.all(
        fileList.map((v) => axios({ url: v.url, responseType: 'arraybuffer' }).then((r) => r.data)),
    );

    debugger;
    const zip = new AdmZip();
    for (const [fIv, data] of fileData.entries()) {
        const fileData = fileList[fIv];
        zip.addFile(`${fileData.name}`, data);
    }

    const fileName = `forward-${replyMsgId}.zip`;
    // fs.mkdirSync(config.onebot.localUploadPath, { recursive: true });
    zip.addZipComment(
        `replyMsgId: ${replyMsgId}` +
            `\ntime: ${new Date().toString()} (${new Date().getTime()})` +
            `\nfiles:\n` +
            fileList.map((v) => `${v.name} --> ${v.url}`).join('\n'),
    );
    const localFileName = `${config.onebot.localUploadPath}/${fileName}`;
    if (fs.existsSync(localFileName)) fs.rmSync(localFileName);
    zip.writeZip(localFileName);

    await msg.sendMsgEx(`文件上传中`);
    await uploadGroupFile({
        group_id: Number(msg.group_openid),
        file: `${config.onebot.remoteUploadPath}/${fileName}`,
    });
}
