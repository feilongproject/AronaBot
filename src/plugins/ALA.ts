import sharp from "sharp";
import { IMessageEx } from "../libs/IMessageEx";
import config from "../../config/config.json";

var allowLen = 20;
var authLen = 0;

export async function generateALA(msg: IMessageEx) {

    const alaQueue = buildALA(msg.content.replace(RegExp("/?奥利奥"), "").replace(`<@!${meId}>`, "").trim());
    if (alaQueue.length <= (allowLen + authLen)) {

        if (alaQueue.length == 0) {
            msg.sendMsgExRef({ content: `未找到奥利奥，在本指令后输入"爱丽丝"三个字符中其中任意一个字符即可生成（可重复）` });
            return;
        }
        return buildImage(alaQueue).then(outPath => {
            return msg.sendMsgEx({ imagePath: outPath });
        }).catch(err => {
            log.error(err);
        });

    } else {
        return msg.sendMsgExRef({
            content: `奥利奥过长(${alaQueue.length}字符),最长可允许长度为${allowLen + authLen}字符` +
                `\n含${allowLen}字符基础长度${authLen == 0 ? `(赞助可以获得更多长度)` : `+${authLen}字符赞助长度`}`
        });
    }
}

function buildALA(content: string) {

    var sp = content.split("");
    const alaQueue: ("01" | "10" | "02" | "20" | "12" | "21")[] = [];

    for (const word of sp) {
        var pop = alaQueue.pop();
        switch (word) {
            case "艾":
            case "爱":
            case "愛":
                if (pop == "12" || pop == "21" || pop == "01" || pop == "02") {
                    alaQueue.push(pop, "10");
                } else if (pop == "10" || pop == "20") {
                    alaQueue.push(pop, "01");
                } else {
                    alaQueue.push("01");
                }
                break;
            case "莉":
            case "丽":
            case "麗":
                if (pop)
                    alaQueue.push(pop, "12");
                else
                    alaQueue.push("12");
                break;
            case "丝":
            case "絲":
                if (pop == "12" || pop == "21" || pop == "01" || pop == "02") {
                    alaQueue.push(pop, "20");
                } else if (pop == "10" || pop == "20") {
                    alaQueue.push(pop, "02");
                } else {
                    alaQueue.push("02");
                }
                break;
            default:
                if (pop) {
                    alaQueue.push(pop);
                }
                log.error(`error word${word}`);
        }
    }
    return alaQueue;
}

async function buildImage(alaQueue: ("01" | "10" | "02" | "20" | "12" | "21")[]): Promise<string> {
    var tmpOutPath = `${config.picPath.out}/${new Date().getTime()}.png`;
    var files: { input: string, top: number, left: number, }[] = [];
    alaQueue.forEach((id, iv) => {
        files.push({
            input: `${config.picPath.cutAris}/${id}.jpg`,
            top: iv * 200,
            left: Math.max((alaQueue.length / 2) * 100 - 100, 0),
        });
    });

    return sharp({
        create: {
            width: Math.max(100 * alaQueue.length, 200),
            height: Math.max(200 * alaQueue.length, 200),
            channels: 3,
            background: "#FFFFFF",
        }
    }).composite(files)
        .toFile(tmpOutPath)
        .then(() => {
            return tmpOutPath;
        });



    //return tmpOutPath;
}