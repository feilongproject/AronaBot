import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import FormData from "form-data";
import { sendToAdmin, sendToGroup } from "../libs/common";
import { IMessageC2C, IMessageGROUP } from "../libs/IMessageEx";


const REMOTE_URL = "http://192.168.10.220:3000"; // server
// const REMOTE_URL = "http://192.168.50.20:3000"; // local
const GROUP_MAP = {
    "1041893514": ["1F510A252BECEB3C3001755939CCF289", "E06A1951FA9B96870654B7919DCF2F5C"],
    "446808751": ["57A9BFF9A91410926173B10A33E18E3D"],
};
const AUTH_KEY = "1145141919810helloworld";

export async function loadFile(msg: IMessageC2C) {
    if (!msg.attachments || !msg.attachments.length) return;
    if (await notCanUse(msg)) return;

    const { filename, size, url: fileUrl } = msg.attachments[0];
    const ext = filename.split(".").pop() || "";
    if (!["mkv", "ass", "mp4", "webm"].includes(ext)) return msg.sendMsgEx({ content: `不支持的文件格式` });


    const runningJob = await redis.hGetAll("transcoding") as any as TranscodingRedis;

    runningJob.uuid = runningJob.uuid || crypto.randomUUID();
    await redis.hSet("transcoding", "uuid", runningJob.uuid);

    runningJob.tmpdir = runningJob.tmpdir || fs.mkdtempSync(path.join(os.tmpdir(), "transcoding-"));
    await redis.hSet("transcoding", "tmpdir", runningJob.tmpdir);


    await msg.sendMsgEx({ content: `下载文件中, 请稍后` });
    const fileBuffer = await fetch(fileUrl).then(res => res.buffer());
    const filePath = path.join(runningJob.tmpdir, filename);
    fs.writeFileSync(filePath, fileBuffer);
    await redis.hSet("transcoding", ext === "ass" ? "subName" : "videoName", filename);
    runningJob[ext === "ass" ? "subName" : "videoName"] = filename;

    return msg.sendMsgEx({
        content: `已保存到 ${filePath}`
            + `\nuuid: ${runningJob.uuid}`
            + `\ntmpdir: ${runningJob.tmpdir}`
            + `\nvideoName: ${runningJob.videoName || ""}`
            + `\nsubName: ${runningJob.subName || ""}`,
    });

}

export async function startJob(msg: IMessageC2C) {
    if (await notCanUse(msg)) return;

    const runningJob = await redis.hGetAll("transcoding") as any as TranscodingRedis;
    const videoPath = path.join(runningJob.tmpdir, runningJob.videoName);
    const subPath = path.join(runningJob.tmpdir, runningJob.subName);
    if (!fs.existsSync(videoPath) || !fs.existsSync(subPath)) {
        return msg.sendMsgEx({ content: `字幕或视频不存在！` });
    }

    const videoBuffer = fs.readFileSync(videoPath);
    const subBuffer = fs.readFileSync(subPath);

    const form = new FormData();
    form.append("video", videoBuffer, { filename: runningJob.videoName });
    form.append("sub", subBuffer, { filename: runningJob.subName });

    await msg.sendMsgEx({ content: `上传中` });
    const uploadInfo: UploadRes = await fetch(`${REMOTE_URL}/upload`, {
        method: "POST",
        headers: { ...form.getHeaders() },
        body: form,
    }).then(res => res.json());

    if (uploadInfo.status !== 100) return msg.sendMsgEx({ content: `上传失败\nstatus: ${uploadInfo.status}\n${uploadInfo.body}` })

    await redis.hSet("transcoding", "remoteUUID", uploadInfo.uuid);
    if (msg instanceof IMessageGROUP) await redis.hSet("transcoding", "groupId", msg.group_id);
    else await redis.hDel("transcoding", "groupId");

    const intervalID = setInterval(check, 60 * 1000, msg)[Symbol.toPrimitive]();
    await redis.hSet("transcoding", "intervalID", intervalID);

    await msg.sendMsgEx({
        content: `任务返回：`
            + `\nintervalID: ${intervalID}`
            + `\nuuid: ${runningJob.uuid}`
            + `\nremoteUUID: ${uploadInfo.uuid}`
            + `\nstatus: ${uploadInfo.status}`
            + `\n${uploadInfo.body}`,
    });

}

export async function statusJob(msg: IMessageGROUP | IMessageC2C) {
    if (await notCanUse(msg)) return;

    const runningJob = await redis.hGetAll("transcoding") as any as TranscodingRedis;
    const nowJob: NowjobRes = await fetch(`${REMOTE_URL}/nowjob?id=${runningJob.remoteUUID}`).then(res => res.json());

    await msg.sendMsgEx({
        content: `${nowJob.body}`
            + `\nstatus: ${nowJob.status}`
            + `\nuuid: ${runningJob.uuid}`
            + `\nremoteUUID: ${runningJob.remoteUUID}`
            + (nowJob.filepath ? `\nfilepath: ${nowJob.filepath}` : ``)
            + (nowJob.process ? `\nprocess: ${nowJob.process}` : ``)
    });

    if (msg.content.includes("log")) {
        await msg.sendMsgEx({ content: nowJob.log || "当前不存在log" });
    }

}

export async function clearJob(msg: IMessageGROUP | IMessageC2C) {
    if (await notCanUse(msg)) return;

    return msg.sendMsgEx({ content: `已删除: ${await redis.del("transcoding")}` });
}

export async function downloadJob(msg: IMessageGROUP | IMessageC2C) {
    if (await notCanUse(msg)) return;

    const runningJob = await redis.hGetAll("transcoding") as any as TranscodingRedis;
    const localVideoName = "【已压】" + runningJob.videoName;
    const localVideoPath = path.join(runningJob.tmpdir, localVideoName);

    const nowJob: NowjobRes = await fetch(`${REMOTE_URL}/nowjob?id=${runningJob.remoteUUID}`).then(res => res.json());
    const cosKey = `transcodingVideo/${nowJob.filepath?.split(/\\|\//).pop() || localVideoName}`;

    if (nowJob.status !== 200) return msg.sendMsgEx({
        content: `文件未准备完毕`
            + `\nstatus: ${nowJob.status}`
            + `\nbody: ${nowJob.body}`

    });
    await msg.sendMsgEx({
        content: `开始下载到本地 ${localVideoName}`
            + `\ntmpdir: ${runningJob.tmpdir}`
            + `\nstatus: ${nowJob.status}`
    });

    if (!fs.existsSync(localVideoPath)) {
        const jobBuffer = await fetch(`${REMOTE_URL}/${nowJob.filepath}`).then(res => res.buffer());
        const _ = await cosPutObject({
            Key: cosKey, Body: jobBuffer,
            Headers: {
                'x-cos-meta-video-name': encodeURI(localVideoName),
                'x-cos-meta-sub-name': encodeURI(runningJob.subName),
                'x-cos-meta-remote-uuid': runningJob.remoteUUID,
                'x-cos-meta-uuid': runningJob.uuid,
            },
        });
        fs.writeFileSync(localVideoPath, jobBuffer);
    }

    const fileInfo = await msg.sendFile({
        fileType: 2,
        fileUrl: cosUrl(cosKey, ""),
    }).catch(async err => {
        await sleep(5000);
        return await msg.sendFile({
            fileType: 2,
            fileUrl: cosUrl(cosKey, ""),
        });
    }).catch(async err => {
        await sleep(5000);
        return await msg.sendFile({
            fileType: 2,
            fileUrl: cosUrl(cosKey, ""),
        });
    }).catch(err => msg.sendMsgEx({ content: `获取fileinfo时出现了一些啸问题\n` + strFormat(err), })).catch(err => log.error(err));
    if (!fileInfo || !fileInfo.result) return;


    await msg.sendMsgEx({ fileInfo: fileInfo.result });
    await redis.del("transcoding");

}

export async function cancelJob(msg: IMessageGROUP | IMessageC2C) {
    if (await notCanUse(msg)) return;

    const runningJob = await redis.hGetAll("transcoding") as any as TranscodingRedis;
    const nowJob: NowjobRes = await fetch(`${REMOTE_URL}/nowjob?id=${runningJob.remoteUUID}`, {
        method: "DELETE",
    }).then(res => res.json());

    return msg.sendMsgEx({
        content: `${nowJob.body}`
            + `\nstatus: ${nowJob.status}`
    });
}

export async function help(msg: IMessageGROUP | IMessageC2C) {
    if (await notCanUse(msg)) return;

    return msg.sendMsgEx({
        content: `命令列表:`
            + `\n\n- 开始压制`
            + `\n   开始压了！（需要先发送视频与字幕）`

            + `\n\n- 下载压制`
            + `\n   小心流量！都是小钱钱！（推送到存储桶并使用CDN发送）`

            + `\n\n- 清空压制`
            + `\n   真的要清空吗？（删除记录，但本地文件还在）`

            + `\n\n- 暂停压制（功能还没写）`
            + `\n   咋瓦鲁多！（停止远端服务器压制）`

            + `\n\n- 取消压制`
            + `\n   心脏，要逃走了！（取消远端服务器上的压制）`

            + `\n\n- 压制进度`
            + `\n   让我看看进度到哪了（有进度条了所以这个没什么用）`
    });
}

export async function auth(msg: IMessageC2C) {
    const match = /压制认证\s*(?<authKey>.+)\s+(?<authName>.+)/.exec(msg.content || "");
    const { authKey, authName } = match?.groups || {};

    if (!authKey) return msg.sendMsgEx({ content: `未找到authKey` });
    if (authKey !== AUTH_KEY) return msg.sendMsgEx({ content: `错误的authKey` });
    if (!authName) return msg.sendMsgEx({ content: `给你自己起个名` });

    await sendToAdmin(`auth:usecommand add`
        + `\nid: ${msg.author.id}`
        + `\nname: ${authName}`);

    await redis.hSet("auth:usecommand", msg.author.id, authName);

    return msg.sendMsgEx({ content: `已授权压制: ${authName}` });
}

async function check(msg?: IMessageGROUP | IMessageC2C) {
    const runningJob = await redis.hGetAll("transcoding") as any as TranscodingRedis;
    const sendGroup = Object.entries(GROUP_MAP).find(v => v[1].includes(runningJob.groupId || ""))?.[0];
    const nowJob: NowjobRes = await fetch(`${REMOTE_URL}/nowjob?id=${runningJob.remoteUUID}`).then(res => res.json());
    if (nowJob.status === 100) return await sendToGroup("echo", `${sendGroup ? "" : `(未找到发送group)\n`}${nowJob.body}\n${nowJob.process}`, sendGroup);

    await sendToGroup("echo",
        `等待已结束${sendGroup ? "" : `(未找到发送group)`}`
        + `\nstatus: ${nowJob.status}`
        + `\nintervalID: ${runningJob.intervalID}`
        + `\n${nowJob.body}`
        , sendGroup);
    clearInterval(runningJob.intervalID);
    await sleep(5 * 1000);

    if (msg) await downloadJob(msg).catch(err => console.log(err));

}

async function notCanUse(msg: IMessageC2C | IMessageGROUP): Promise<boolean> {
    if (adminId.includes(msg.author.id)) return false;
    if (await redis.hGet("auth:usecommand", msg.author.id)) return false;
    return true;
}


interface TranscodingRedis {
    uuid: string;
    tmpdir: string;
    videoName: string;
    subName: string;
    remoteUUID: string;
    groupId?: string;
    intervalID?: string;
};

interface UploadRes {
    status: 100 | 400 | 429;
    uuid: string;
    body: string;
}

interface NowjobRes {
    status: 0 | 100 | 200 | 500;
    body: string;
    filepath?: string;
    log?: string;
    process?: string; // 仅 status==100 存在
};