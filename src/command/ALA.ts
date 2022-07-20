import { IMessage, OpenAPI } from "qq-guild-bot";
import sharp from "sharp";
import config from "../../data/config.json";
import log from "../mod/logger";
import { sendImage, sendMsg } from "../mod/sendMsg";
export async function commandALA(client: OpenAPI, msg: IMessage & IMessageEx, content: string) {


    //var content = msg.content;
    if (content.length > 8) {
        const alaQueue = buildALA(content);
        //gm()
        buildImage(alaQueue).then(outPath => {
            sendImage(msg, outPath);
        });
    } else {
        sendMsg(client, msg.channel_id, msg.id, "奥利奥过长");
    }


}

function buildALA(content: string) {
    //log.debug(content);
    var sp = content.split("");
    //log.debug(sp);

    var alaQueue: ("01" | "10" | "02" | "20" | "12" | "21")[] = [];
    sp.forEach((word, iv) => {
        //var word: "爱" | "丽" | "丝" = w as any;
        var pop = alaQueue.pop();


        switch (word) {
            case "艾":
            case "爱":
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
                if (pop)
                    alaQueue.push(pop, "12");
                else
                    alaQueue.push("12");
                break;
            case "丝":
                if (pop == "12" || pop == "21" || pop == "01" || pop == "02") {
                    alaQueue.push(pop, "20");
                } else if (pop == "10" || pop == "20") {
                    alaQueue.push(pop, "02");
                } else {
                    alaQueue.push("02");
                }
                break;
            default:
                log.error(`error word${word}`);
        }
    });
    return alaQueue;
}

async function buildImage(alaQueue: ("01" | "10" | "02" | "20" | "12" | "21")[]): Promise<string> {
    var tmpOutPath = `${config.picPath.out}/${new Date().getTime()}.png`;
    var files: { input: string, top: number, left: number, }[] = [];
    alaQueue.forEach((id, iv) => {
        files.push({
            input: `${config.picPath.cutAris}/${id}.jpg`,
            top: iv * 200,
            left: (alaQueue.length / 2) * 100 - 100,
        });
    });

    return sharp({
        create: {
            width: 100 * alaQueue.length,
            height: 200 * alaQueue.length,
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
