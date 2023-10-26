import { findStudentInfo } from "../src/libs/common";


export const match = {
    names: {
        totalAssault: {
            reg: "^/?总力战一图流",
            typeReg: "(总力战?(一图流?)?)|(totalAssault)",
            desc: "总力战一图流",
            has: ["jp", "global"],
        },
        globalClairvoyance: {
            reg: "^/?千里眼",
            typeReg: "(千里眼?)|(global(Clairvoyance)?)",
            desc: "千里眼",
            has: ["all"],
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
    },
}

export const adapter: Record<string, (content: string, type?: "GET") => ReturnType<typeof studentEvaluation>> = {
    studentEvaluation,
}

function studentEvaluation(content: string, type?: "GET"): { id: string; desc?: string; } {
    const studentName = content.replace(/\/?(角评|角色评价)/, "").trim();
    if (!studentName || studentName == "all") return { id: "all" };
    const findedInfo = findStudentInfo(studentName);
    if (!findedInfo) throw `未找到学生『${studentName}』数据`;
    return { id: findedInfo.pathName, desc: findedInfo.name[0] };
}