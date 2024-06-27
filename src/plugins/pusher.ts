import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { sendToAdmin } from "../libs/common";
import { IMessageDIRECT } from "../libs/IMessageEx";


export async function updateGithubVersion(msg?: IMessageDIRECT) {
    if (!devEnv && await redis.exists("push:ghUpdate")) return;
    if (msg && !adminId.includes(msg.author.id)) return;

    await msg?.sendMsgEx({ content: "updating" });
    const queue: Promise<GithubBranchInfobar | undefined>[] = [];
    const proxyHosts = ["https://gh.schale.top", "https://github.com"];
    for (const host of proxyHosts) {
        for (const _ of Array.from({ length: 5 })) {
            queue.push(fetch(`${host}/feilongproject/SchaleDB/branch-infobar/main`, {
                timeout: 10 * 1000,
                headers: { Accept: "application/json" },
            }).then(res => res.json() as Promise<GithubBranchInfobar>).catch(err => undefined));
        }
    }

    return Promise.all(queue).then(branchInfos => {
        const branchInfo = branchInfos.find(v => v);
        if (!branchInfo) throw "reg unmatched";

        const { behind, ahead, baseBranchRange } = branchInfo.refComparison;
        const branchInfoString = `Branch ahead:${ahead}, behind:${behind} -> ${baseBranchRange}`;

        if (msg) return msg.sendMsgEx({ content: JSON.stringify(branchInfoString) });
        if (behind) return sendToAdmin(branchInfoString).then(() => redis.setEx("push:ghUpdate", 60 * 60 * 1, branchInfoString) as any);
    }).catch(err => {
        log.error(err);
        return sendToAdmin("updateGithubVersion\n" + JSON.stringify(err).replaceAll(".", "。"));
    }).catch(err => {
        log.error(err);
    });

}

interface GithubBranchInfobar {
    refComparison: {
        behind: number; // 原仓库比镜像领先部分
        ahead: number; // 镜像比原仓库领先部分
        baseBranch: `${string}/${string}:${string}`;
        baseBranchRange: `${string}:${string}:${string}`;
        currentRef: string;
        isTrackingBranch: boolean;
    };
    pullRequestNumber: null;
}
