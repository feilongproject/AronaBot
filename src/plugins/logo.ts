import RE2 from "re2";
import { btoa } from "js-base64";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { contentCensor as AipContentCensorClient } from "baidu-aip-sdk";
import { createCanvas, Canvas, registerFont, DOMMatrix, loadImage, } from "canvas";
import { sendToAdmin } from "../libs/common";
import { IMessageGROUP, IMessageGUILD } from "../libs/IMessageEx";
import config from "../../config/config";


registerFont(`${config.fontRoot}/GlowSansSC-Normal-Heavy.otf`, { family: "Glow Sans SC", weight: "Heavy" });
registerFont(`${config.fontRoot}/RoGSanSrfStd-Bd.otf`, { family: "Ro GSan Serif Std" });

export async function baLogo(msg: IMessageGUILD | IMessageGROUP) {
    // log.debug(msg.content);
    const match = RE2("/?[Bb][Aa][-_]?[Ll][Oo][Gg][Oo]\\s+(?P<textL>\\S+)\\s+(?P<textR>\\S+)").match(msg.content);
    if (!match) return msg.sendMsgExRef({
        content: `命令错误，命令格式：`
            + `\n/balogo 左文字 右文字`
            + `\n注意：命令与左文字、左文字与右文字中间必须存在空格，否则无法识别`
    });
    const { textL, textR } = match.groups!;

    const client = new AipContentCensorClient(config.baiduCensoring.APP_ID, config.baiduCensoring.API_KEY, config.baiduCensoring.SECRET_KEY);
    const result = await client.textCensorUserDefined(`${textL}\n${textR}\n${textL}${textR}`);
    // log.debug(result);

    if (!result.data || !result.conclusion || !!result.conclusionType) {
        log.error(result);
        return msg.sendMsgExRef({
            content: (msg instanceof IMessageGROUP ? "" : `<@${msg.author.id}>`) + `敏感词检测失败:\n${JSON.stringify(result)}`
        });
    }

    if (result.data.find(v => v.subType == 3)) {
        if (msg instanceof IMessageGROUP) await redis.hSet(`ban:use:group`, msg.group_id, "群聊中有人存在使用机器人发布政治敏感消息");
        else await redis.hSet(`ban:use:guild`, msg.guild_id, "频道中存在使用机器人发布政治敏感消息");
        await redis.hSet(`ban:use:user`, msg.author.id, "历史中存在使用机器人发布政治敏感消息");
    }

    if (result.conclusionType != 1) return msg.sendMsgExRef({
        content: (msg instanceof IMessageGROUP ? "" : `<@${adminId[0]}>`) + `检测词组违规:\n` + result.data!.map(v => v.msg).join(`\n`),
    }).then(() => sendToAdmin(
        `balogo检测到违禁词\n`
        + (msg instanceof IMessageGROUP ? `用户: ${msg.author.id}` : `用户: ${msg.author.username} (${msg.author.id})`) + "\n"
        + (msg instanceof IMessageGROUP ? `群聊: ${msg.group_id}` : `子频道: ${msg.channelName} (${msg.channel_id})`)
        + `\n违规原因: ${result.conclusionType} ${result.conclusion}\n`
        + result.data!.map((d, i) =>
            `\nindex: ${i}\n`
            + `type: ${d.type}-${d.subType} ${d.msg}\n`
            + `hits:\n`
            + `${d.hits.map(hit =>
                `->${hit.datasetName}: (${hit.words})\n`
                + `->wordHitPositions:\n`
                + `${hit.wordHitPositions.map((pos, i) =>
                    `-->${i}k: ${pos.keyword}\n`
                    + `-->${i}l: ${pos.label}\n`
                    + `-->${i}p: ${pos.positions.join("|")}`).join("\n")}`
                + `modelHitPositions:\n`
                + `${hit.modelHitPositions.map((pos, i) =>
                    `-->${i}: ${pos}\n`).join("\n")}`
            ).join("\n")}`
        ).join("\n")
    ));

    const fileName = `${btoa(textL)}-${btoa(textR)}.png`;
    const saveFilePath = `${config.imagesOut}/${fileName}`;
    if (!existsSync(saveFilePath)) writeFileSync(saveFilePath, await generate(textL, textR), { encoding: "binary" });

    return msg.sendMsgEx({
        content: msg instanceof IMessageGROUP ? "" : `<@${msg.author.id}>`,
        imageUrl: `https://ip.arona.schale.top/p/gacha/${fileName}`,
    });
}

async function generate(textL: string, textR: string, transparentBg = false) {
    const fontSize = 168;
    const canvasHeight = 500;
    const canvasWidth = 200;
    const textBaseLine = 0.68;
    const horizontalTilt = -0.4;
    const paddingX = 20;
    const graphOffset = { X: -30, Y: 0 };
    const hollowPath = [
        [568, 272],
        [642, 306],
        [318, 820],
        [296, 806],
    ];

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const c = canvas.getContext('2d');

    const font = `${fontSize}px 'Ro GSan Serif Std', 'Glow Sans SC', sans-serif`;
    c.font = font;

    // extend canvas
    const textMetricsL = c.measureText(textL);
    const textMetricsR = c.measureText(textR);

    const textWidthL = textMetricsL.width - (textBaseLine * canvasHeight + textMetricsL.actualBoundingBoxAscent) * horizontalTilt;
    const textWidthR = textMetricsR.width + (textBaseLine * canvasHeight - textMetricsR.actualBoundingBoxAscent) * horizontalTilt;

    const canvasWidthL = textWidthL + paddingX > canvasWidth / 2 ? textWidthL + paddingX : canvasWidth / 2;
    const canvasWidthR = textWidthR + paddingX > canvasWidth / 2 ? textWidthR + paddingX : canvasWidth / 2;

    canvas.width = canvasWidthL + canvasWidthR;

    // clear canvas
    c.clearRect(0, 0, canvas.width, canvas.height);

    // background
    if (!transparentBg) {
        c.fillStyle = '#fff';
        c.fillRect(0, 0, canvas.width, canvas.height);
    }

    // // left blue text
    c.font = font;
    c.fillStyle = '#128AFA';
    c.textAlign = 'end';
    c.setTransform(new DOMMatrix([1, 0, horizontalTilt, 1, 0, 0]));
    c.fillText(textL, canvasWidthL, canvas.height * textBaseLine);
    c.resetTransform(); // restore don't work

    // halo
    c.drawImage(
        await loadImage(readFileSync(`${config.images.baLogo}/halo.png`)),
        canvasWidthL - canvas.height / 2 + graphOffset.X,
        graphOffset.Y,
        canvasHeight,
        canvasHeight
    );

    // right black text
    c.fillStyle = '#2B2B2B';
    c.textAlign = 'start';
    if (transparentBg) c.globalCompositeOperation = 'destination-out';
    c.strokeStyle = 'white';
    c.lineWidth = 12;
    c.setTransform(new DOMMatrix([1, 0, horizontalTilt, 1, 0, 0]));
    c.strokeText(textR, canvasWidthL, canvas.height * textBaseLine);

    c.globalCompositeOperation = 'source-over';
    c.fillText(textR, canvasWidthL, canvas.height * textBaseLine);
    c.resetTransform();

    // cross stroke
    const graph = {
        X: canvasWidthL - canvas.height / 2 + graphOffset.X,
        Y: graphOffset.Y,
    };
    c.beginPath();
    hollowPath.forEach(([x, y], i) => {
        const f = (i === 0 ? c.moveTo : c.lineTo).bind(c);
        f(graph.X + x / 2, graph.Y + y / 2);
    });
    c.closePath();

    if (transparentBg) c.globalCompositeOperation = 'destination-out';
    c.fillStyle = 'white';
    c.fill();
    c.globalCompositeOperation = 'source-over';

    // cross
    c.drawImage(
        await loadImage(readFileSync(`${config.images.baLogo}/cross.png`)),
        canvasWidthL - canvas.height / 2 + graphOffset.X,
        graphOffset.Y,
        canvasHeight,
        canvasHeight
    );

    // output
    let outputCanvas: Canvas;
    if (textWidthL + paddingX >= canvasWidth / 2 && textWidthR + paddingX >= canvasWidth / 2) {
        outputCanvas = canvas;
    } else {
        outputCanvas = createCanvas(textWidthL + textWidthR + paddingX * 2, canvas.height);

        const ctx = outputCanvas.getContext('2d');
        ctx.drawImage(
            canvas,
            canvasWidth / 2 - textWidthL - paddingX,
            0,
            textWidthL + textWidthR + paddingX * 2,
            canvas.height,
            0,
            0,
            textWidthL + textWidthR + paddingX * 2,
            canvas.height
        );
    }

    return outputCanvas.toBuffer();
}