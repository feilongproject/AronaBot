import fs from "fs";
import { findStudentInfo, sendToAdmin } from "../src/libs/common";


export const match = {
    names: {
        totalAssault: {
            reg: "^/?总力战一图流",
            typeReg: "(总力战?(一图流?)?)|(totalAssault)",
            desc: "总力战一图流",
            has: ["jp", "global"],
        },
        clairvoyance: {
            reg: "^/?(千|万)里眼",
            typeReg: "(千里眼?)|(clairvoyance)",
            desc: "千里眼",
            has: ["global", "cn"],
        },
        activityStrategy: {
            reg: "^/?活动攻略",
            typeReg: "(活动(攻略)?)|(activity(Strategy)?)",
            desc: "活动攻略",
            has: ["jp", "global"],
        },
        studentEvaluation: {
            reg: "^/?(角评|角色评价)",
            typeReg: "(角评|角色评价)|student(Evaluation)?",
            desc: "角评",
            has: ["all"],
        },
    },
    types: {
        global: "(国际|g)服?",
        jp: "(日|jp)服?",
        cn: "(国|cn)服?",
    },
}

export const adapter: Record<string, (content: string, type?: "GET") => ReturnType<typeof studentEvaluation>> = {
    studentEvaluation,
}

async function studentEvaluation(content: string, type?: "GET"): Promise<{ id: string; desc?: string | undefined; }> {
    const studentName = content.replace(/\/?(角评|角色评价)/, "").trim();
    if (!studentName || studentName == "all") return { id: "all" };
    const findedInfo = findStudentInfo(studentName);
    if (findedInfo) return { id: findedInfo.pathName, desc: findedInfo.name[0] };

    await sendToAdmin(`未找到学生『${studentName}』数据`).catch(err => log.error("handbookMatches.studentEvaluation", err));
    const notNameList: string[] = JSON.parse(fs.readFileSync("/root/RemoteDir/qbot/AronaBot/data/studentNameAlias.json").toString());
    notNameList.includes(studentName) ? "待整理数据库已存在该别名" : "待整理数据库未存在，已推送";
    if (!notNameList.includes(studentName)) notNameList.push(studentName);
    fs.writeFileSync("/root/RemoteDir/qbot/AronaBot/data/studentNameAlias.json", JSON.stringify(notNameList));
    throw `未找到学生『${studentName}』数据`;

}