import fs from "fs";
import { IMessageGUILD } from "../libs/IMessageEx";
import ostracismWord from "../../data/ostracismWord.json";
const userDataFile = "./data/ostracismData.json";

/* 
TODO
全部逻辑待优化
*/
export async function ostracism(msg: IMessageGUILD) {

    var { content } = msg;//
    var command = content.slice(5, 10).trim();
    var otherContent = content.slice(10).trim();
    log.info(`command:${command},otherContent:${otherContent}`);
    if (otherContent?.trim() == "" && command != "结束议题") {
        return msg.sendMsgEx({ content: `议题标题为空，请重试` });
    }

    var data = fs.readFileSync(userDataFile, { encoding: "utf-8" });
    var ostracismData: OstracismData = JSON.parse(data);
    if (ostracismData.iv == undefined) ostracismData = { iv: 0, list: [], };


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
                    forUser: (msg.mentions || [null])[1] == null ? undefined : { id: (msg.mentions || [null])[1]!.id, name: (msg.mentions || [null])[1]!.username, },
                },
            });
            ostracismData.iv = ostracismData.list.length - 1;
            msg.sendMsgEx({
                content: `创建完成，类型:${typeId},编号:${ostracismData.iv}` +
                    `\n频道:${msg.guild_name ? msg.guild_name : "null"}(${msg.guild_id})` +
                    `\n标题:${otherContent}${(msg.mentions || [null])[1] == null ? "" : `\n目标用户:<@${(msg.mentions || [null])[1]!.id}>`}`
            })
            break;
        case "编辑议题":
            log.debug(msg.attachments);
            (ostracismData.list[ostracismData.iv].infos as unknown as InfoType[]).push({
                content: otherContent,
                attachments: msg.attachments as unknown as Attachments[],

            });
            break;
        case "查询议题":
            if (otherContent != "") {
                ostracismData.iv = parseInt(content.slice(10));
                msg.sendMsgEx({
                    content: `查询编号:${ostracismData.iv}` +
                        `\n标题:${ostracismData.list[ostracismData.iv].title}` +
                        `\n内容:${ostracismData.list[ostracismData.iv].infos}`
                })
            }
            break;
        case "投票":
        case "提议投票":
        case "议题投票":
        case "投票提议":
        case "投票议题":
            var optionStr = `对议题\n【${ostracismData.list[ostracismData.iv].title}】(编号${ostracismData.iv})\n`;
            switch (otherContent) {
                case "赞同":
                case "支持":
                case "认同":
                case "同意":
                case "赞成":
                    ostracismData.list[ostracismData.iv].opinion.agree.push({ id: msg.author.id, name: msg.author.username });
                    optionStr += `已记录赞成意见\n`;
                    break;
                case "一斤鸭梨":
                case "反对":
                    ostracismData.list[ostracismData.iv].opinion.against.push({ id: msg.author.id, name: msg.author.username });
                    optionStr += `已记录反对意见\n`;
                    break;
                case "弃权":
                    ostracismData.list[ostracismData.iv].opinion.abstain.push({ id: msg.author.id, name: msg.author.username });
                    optionStr += `已记录弃权意见\n`;
                    break;
                default:

                    optionStr = `未知意见\n`;
                    //sendMsg(client, msg.channel_id, msg.id, );
                    break;
            }
            const options = ostracismData.list[ostracismData.iv].opinion;
            optionStr += `当前票数统计结果(赞成/反对/弃权):${options.agree.length}/${options.against.length}/${options.abstain.length}`;
            msg.sendMsgEx({ content: optionStr });
            break;
        case "结束议题":
            var o = ostracismData.list[ostracismData.iv];
            var agree = o.opinion.agree.length;
            var against = o.opinion.against.length;
            var abstain = o.opinion.abstain.length;

            var sendStr = `已结束对【${o.title}】的议题\n`;
            o.infos == undefined ? sendStr += `` : `议题内容:${o.infos}\n`;
            sendStr += `投票统计(赞成/反对/弃权):${agree}/${against}/${abstain}\n`;

            if (agree > against) {
                if (o.type.id == 0 && o.type.forUser) {

                    /* client.muteApi.muteMember(o.guildId, o.type.forUser.id, { seconds: o.type.seconds }).then(() => {
                        sendStr += `同意大于反对,已对用户${o.type.forUser?.name}执行禁言\n`;
                    }).catch((error) => {
                        log.error(error);
                        sendStr += `执行禁言时发生了一些错误${error}\n`;
                    }); */

                    //sendMsg(client, msg.channel_id, msg.id, `当前同意大于反对，执行禁言`);
                } else if (o.type.id == 1) {
                    //sendMsg(client, msg.channel_id, msg.id, `移出功能尚未实现`);
                } else if (o.type.id == 2) {
                    //sendMsg(client, msg.channel_id, msg.id, ``);
                }
            } else {
                sendStr += `同意未大于反对,取消执行\n`;
                //sendMsg(client, msg.channel_id, msg.id, `当前`);
            }
            sendStr += `当前议题已存档，编号${ostracismData.iv}`;
            msg.sendMsgEx({ content: sendStr })
            break;
        default:
            msg.sendMsgEx({ content: `未知命令` })
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

function findCommand(key: string, type: string): boolean {
    Object.keys(ostracismWord).forEach((obj) => {
        const word = ostracismWord[obj as keyof OstracismWord];
        //log.debug(obj);
        //log.debug(word);
        //console.log(k, obj[k as keyof Person].toUpperCase());
    })
    return false;
}

interface OstracismWord {
    create: {
        index: string[],
    },
    vote: {
        index: string[],
        opinion: {
            agree: string[],
            against: string[],
            abstain: string[],
        }
    }
}

interface OstracismData {
    iv: number,
    list: {
        guildId: string,
        guildName: string,
        title: string,
        infos: InfoType[],
        opinion: Opinion,
        isEnd: boolean,
        type: OstracismType,
    }[],
}

interface InfoType {
    content: string,
    attachments?: Attachments[],
}

interface Attachments {
    content_type: string,
    filename: string,
    height: number,
    id: string,
    size: number,
    url: string,
    width: number,
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

