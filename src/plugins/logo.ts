import { createCanvas, Canvas, registerFont, DOMMatrix, loadImage, } from "canvas";
import { readFileSync, } from "fs";
import config from "../../config/config.json";
import { IMessageGUILD } from "../libs/IMessageEx";
import RE2 from "re2";


registerFont(`${config.fontRoot}/GlowSansSC-Normal-Heavy.otf`, { family: "Glow Sans SC", weight: "Heavy" });
registerFont(`${config.fontRoot}/RoGSanSrfStd-Bd.otf`, { family: "Ro GSan Serif Std" });

export async function baLogo(msg: IMessageGUILD) {
    const match = RE2("^/?(b|B)(a|A)-?(L|l|)(o|O)(g|G)(o|O)\\s+(?P<textL>\\S+)\\s+(?P<textR>\\S+)").match(msg.content);
    if (!match) return msg.sendMsgExRef({
        content: `命令错误，命令格式：` +
            `/balogo 左文字 右文字`
    });
    const { textL, textR } = match.groups!;

    log.debug(JSON.stringify(msg));

    return generate(textL, textR).then(buff => msg.sendMsgEx({
        content: `<@${msg.author.id}>`,
        imageFile: buff,
    }));
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