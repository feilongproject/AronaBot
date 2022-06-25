import { IMessage, OpenAPI } from "qq-guild-bot";
import fs from "fs";
import log from "../mod/logger";
import { sendMsg } from "../mod/sendMsg";
const userDataFile = "./dist/file/ostracismData.json";

export async function ostracism(client: OpenAPI, msg: IMessage & IMessageEx) {

    var { content } = msg;//
    var command = content.slice(5, 10).trim();
    var otherContent = content.slice(10).trim();
    log.info(`command:${command},otherContent:${otherContent}`);
    if (otherContent.trim() == "" && command != "结束议题") {
        sendMsg(client, msg.channel_id, msg.id, `议题标题为空，请重试`);
        return;
    }

    var data = fs.readFileSync(userDataFile, { encoding: "utf-8" });
    var ostracismData: OstracismData = JSON.parse(data);
    if (ostracismData.iv == undefined) ostracismData = { iv: 0, list: [], };

    //log.info(msg);

    switch (command) {
        case "/创建议题":
        case "发起议题":
        case "创建提议":
        case "创建议题"://forUser 未使用
            var typeId = 2;
            var seconds = 0;
            //var forU = "null";


            {//是否有禁言
                var exec = /禁言\d*(分钟|小时|天)/.exec(content);
                if (exec) {
                    typeId = 0;
                    seconds = parseInt(/[0-9]+/.exec(exec[0])![0]);
                    if (exec[0].endsWith("分钟")) {
                        seconds *= 60;
                    } else if (exec[0].endsWith("小时")) {
                        seconds *= 60 * 60;
                    } else if (exec[0].endsWith("天")) {
                        seconds *= 60 * 60 * 24;
                    }
                }
            }
            { //是否@了目标

                /*  var exec = /<@![0-9]+>/.exec(content);
                 if (exec) {
                     forU = exec[0].slice(3, -1);
                 } */

            }

            ostracismData.list.push({
                guildId: msg.guild_id,
                guildName: msg.guild_name ? msg.guild_name : "null",
                title: otherContent,
                infos: [],
                opinion: { agree: [], against: [], abstain: [], },
                isEnd: false,
                type: {
                    id: typeId,
                    seconds: seconds.toString(),
                    forUser: msg.mentions[1] == null ? undefined : { id: msg.mentions[1].id, name: msg.mentions[1].username, },
                },
            });
            ostracismData.iv = ostracismData.list.length - 1;
            sendMsg(client, msg.channel_id, msg.id, `创建完成，类型:${typeId},编号:${ostracismData.iv}\n频道:${msg.guild_name ? msg.guild_name : "null"}(${msg.guild_id})\n标题:${otherContent}${msg.mentions[1] == null ? "" : `\n目标用户:<@${msg.mentions[1].id}>`}`);
            break;
        case "编辑议题":
            ostracismData.list[ostracismData.iv].content = otherContent;
            sendMsg(client, msg.channel_id, msg.id, `编辑完成，类型:${ostracismData.list[ostracismData.iv].type.id},编号:${ostracismData.iv}\n频道:${msg.guild_name ? msg.guild_name : "null"}(${msg.guild_id})\n标题:${otherContent}`);
            break;
        case "查询议题":
            if (otherContent != "") {
                ostracismData.iv = parseInt(content.slice(10));
            }
            sendMsg(client, msg.channel_id, msg.id, `查询编号:${ostracismData.iv}\n标题:${ostracismData.list[ostracismData.iv].title}\n内容:${ostracismData.list[ostracismData.iv].content}`);
            break;
        case "投票":
        case "提议投票":
        case "议题投票":
        case "投票提议":
        case "投票议题":
            //if (ostracismData.list[ostracismData.iv].opinion.agree.findIndex(findOpinion, msg.author.id) == -1)
            switch (otherContent) {
                case "赞同":
                case "支持":
                case "认同":
                case "同意":
                case "赞成":
                    ostracismData.list[ostracismData.iv].opinion.agree.push({ id: msg.author.id, name: msg.author.username });
                    sendMsg(client, msg.channel_id, msg.id, `已记录赞成意见`);
                    break;
                case "一斤鸭梨":
                case "反对":
                    ostracismData.list[ostracismData.iv].opinion.against.push({ id: msg.author.id, name: msg.author.username });
                    sendMsg(client, msg.channel_id, msg.id, `已记录反对意见`);
                    break;
                case "弃权":
                    ostracismData.list[ostracismData.iv].opinion.abstain.push({ id: msg.author.id, name: msg.author.username });
                    sendMsg(client, msg.channel_id, msg.id, `已记录弃权意见`);
                    break;
                default:
                    sendMsg(client, msg.channel_id, msg.id, `未知意见`);
                    break;
            }
            break;
        case "结束议题":
            var o = ostracismData.list[ostracismData.iv];
            var agree = o.opinion.agree.length;
            var against = o.opinion.against.length;
            var abstain = o.opinion.abstain.length;
            if (agree > against) {
                if (o.type.id == 0 && o.type.forUser) {
                    client.muteApi.muteMember(o.guildId, o.type.forUser.id, { seconds: o.type.seconds });
                    sendMsg(client, msg.channel_id, msg.id, `投票统计：\n同意${agree}票；反对${against}票，弃权${abstain}票\n当前同意大于反对，执行禁言`);
                } else if (o.type.id == 1) {
                    sendMsg(client, msg.channel_id, msg.id, `投票统计：\n同意${agree}票；反对${against}票，弃权${abstain}票\n移出功能尚未实现`);
                } else if (o.type.id == 2) {
                    sendMsg(client, msg.channel_id, msg.id, `投票统计：\n同意${agree}票；反对${against}票，弃权${abstain}票`);
                }
            } else {
                sendMsg(client, msg.channel_id, msg.id, `投票统计：\n同意${agree}票；反对${against}票，弃权${abstain}票\n当前同意票数未大于反对，议题已存档`);
            }
            break;
        //ostracismData.list[ostracismData.iv];
        default:
            sendMsg(client, msg.channel_id, msg.id, `未知命令`);
            break;
    }






    fs.writeFileSync(userDataFile, JSON.stringify(ostracismData), { encoding: "utf-8" });
}

function findOpinion(this: any, value: Member, index: number, obj: Member[]): boolean {
    log.info(`find${this}from${value}`);
    if (value.id == this)
        return true;
    else return false;

}



interface OstracismData {
    iv: number,
    list: {
        guildId: string,
        guildName: string,
        title: string,
        content?: string,
        pic?: string[],
        opinion: Opinion,
        isEnd: boolean,
        type: OstracismType,
    }[],

}

interface OstracismType {
    id: number,//0:禁言,1:踢出,2:自定义
    seconds: string,//仅当id=0时启用
    forUser?: Member,
}

interface Opinion {
    agree: Member[],
    against: Member[],
    abstain: Member[],
}

