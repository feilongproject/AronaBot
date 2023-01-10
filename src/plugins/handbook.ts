import { settingConfig } from "../libs/common";
import { IMessageGUILD } from "../libs/IMessageEx";


export async function onePictureTotalAssault(msg: IMessageGUILD) {
    const setting = await settingConfig(msg.author.id, "GET", ["server"]);
    return msg.sendMsgEx({
        content: `<@${msg.author.id}> (${setting.server == "jp" ? "日服" : "国际服"}总力战一图流)`,
        imageUrl: `https://arona.feilongproject.com/onePictureTotalAssault/${setting.server == "jp" ? "jp" : "global"}Lastest.png`,
    });
}