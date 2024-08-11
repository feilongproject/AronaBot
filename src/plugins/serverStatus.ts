import fetch from "node-fetch";
import format from "date-format";
import { readFileSync } from "fs";
import { IMessageC2C, IMessageDIRECT, IMessageGROUP, IMessageGUILD } from "../libs/IMessageEx";


export async function baServerStatus(msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C) {

    const jpStatus = fetch("https://d3656gtd9j62z1.cloudfront.net/prod/index.json", {
    }).then(res => res.json() as Promise<ServerStatusJP>).catch(err => log.error(err)); // prod-noticeindex.bluearchiveyostar.com

    const globalStatus = fetch("https://d13o75oynjs6mz.cloudfront.net/sdk/enterToy.nx", { // https://m-api.nexon.com/sdk/enterToy.nx
        method: "POST",
        headers: {
            // npparams: readFileSync(`${_path}/data/npparams`).toString(),
            // acceptLanguage: "zh_TW",
            "X-Forwarded-For": "8.8.8.8",
        },
        body: readFileSync(`${_path}/data/getPromotion.nx`),
    }).then(res => res.json() as Promise<ServerStatusGlobal>).catch(err => log.error(err));

    const cnStatus = await fetch(`https://ba.gamekee.com/v1/wiki/index`, {
        headers: { "game-alias": "ba" },
    }).then(res => res.json() as Promise<Gamekee.Index>).catch(err => log.error(err));

    return Promise.all([jpStatus, globalStatus, cnStatus]).then(([jpStatus, globalStatus, cnStatus]) => {
        if (!jpStatus || !globalStatus || !cnStatus) return msg.sendMsgEx({ content: `网络连接失败，请稍后重试`, });
        // log.debug(json.Maintenance.StartDate)
        const jpEndTime = new Date(jpStatus.Maintenance.EndDate);
        const jpContent = (jpEndTime.getTime() + 1000 * 60 * 60 <= new Date().getTime()) ?
            "日服一切正常, 暂无官方维护通知" :
            `日服状态:` +
            `\n开始维护时间: ${jpStatus.Maintenance.StartDate}` +
            `\n终止维护时间: ${jpStatus.Maintenance.EndDate}` +
            `\n原因: ${jpStatus.Maintenance.Text}`;

        const globalStartTime = new Date(Number(globalStatus.result.maintenanceInfo?.startTime || 0));
        const globalEndTime = new Date(Number(globalStatus.result.maintenanceInfo?.finishTime || 0));
        const globalContent = (globalStatus.result.maintenanceInfo) ?
            `国际服状态: ${globalStatus.errorText}` +
            `\n开始维护时间: ${format.asString(globalStartTime)}` +
            `\n终止维护时间: ${format.asString(globalEndTime)}` +
            `\n原因: ${globalStatus.result.maintenanceInfo.title}` :
            "国际服一切正常, 暂无官方维护通知";

        const cnNode = cnStatus.data.find(v => v.module.name == "活动周历")?.list.filter(v => v.pub_area == "国服").find(v => v.title.includes("国服维护"));
        const cnStartTime = new Date((cnNode?.begin_at || 0) * 1000);
        const cnEndTime = new Date((cnNode?.end_at || 0) * 1000);
        const cnContent = cnNode && (cnEndTime.getTime() > new Date().getTime()) ?
            `国服状态: ${cnNode.title}` +
            `\n开始维护时间: ${format.asString(cnStartTime)}` +
            `\n终止维护时间: ${format.asString(cnEndTime)}` :
            "国服一切正常, 暂无维护通知（具体以游戏内提示为准）";

        return msg.sendMsgEx({ content: jpContent + "\n\n" + globalContent + "\n\n" + cnContent, });
    }).catch(err => {
        log.error(err);
        return msg.sendMsgExRef({ content: `获取服务器状态时出错，请稍后重试` });
    });
}

interface ServerStatusJP {
    Notices: {
        NoticeId: number;
        StartDate: string;
        EndDate: string;
        Url: string;
        Title: string;
    }[];
    Events: {
        NoticeId: number;
        StartDate: string;
        EndDate: string;
        Url: string;
        Title: string;
    }[];
    Maintenance: {
        StartDate: string;
        EndDate: string;
        Text: string;
    };
    Banners: {
        BannerId: number;
        StartDate: string;
        EndDate: string;
        Url: string;
        FileName: string[];
        LinkedLobbyBannerId: number;
        BannerType?: number;
    }[];
    ServerStatus: number;
    LatestClientVersion: string;
    GachaProbabilityDisplay: {
        GachaProbabilityDisplayId: number;
        Url: string;
        LinkedLobbyBannerId: number;
    }[];
    NotificationBeforeMaintenance: {
        PopupType: number;
        StartDate: string;
        EndDate: string;
        Text: string;
    };
    ContentLock: [];
    GachaPeriodDisplay: {
        GachaPeriodDisplayId: number;
        Text: string;
    }[];
    Survey: {
        SurveyId: number;
        PopupType: number;
        StartDate: string;
        EndDate: string;
        FileName: string;
        Url: string;
        Text: string;
    };
}

interface ServerStatusGlobal {
    errorCode: number;
    result: {
        service: {
            title: string;
            buildVer: string;
            policyApiVer: string;
            termsApiVer: string;
            useTPA: number;
            useGbNpsn: number;
            useGbKrpc: number;
            useGbArena: number;
            useGbJppc: number;
            useToyBanDialog: number;
            grbRating: string;
            networkCheckSampleRate: string;
            nkMemberAccessCode: string;
            useIdfaCollection: number;
            useIdfaDialog: number;
            useIdfaDialogNTest: number;
            useNexonOTP: number;
            useRegionLock: number;
            usePcDirectRun: number;
            useArenaCSByRegion: number;
            usePlayNow: number;
            loginUIType: string;
            clientId: string;
            useMemberships: number[];
            useMembershipsInfo: {
                nexonNetSecretKey: string;
                nexonNetProductId: string;
                nexonNetRedirectUri: string;
            };
        };
        endBanner: {};
        country: string;
        idfa: {
            dialog: any[];
            imgUrl: string;
            language: string;
        };
        useLocalPolicy: string[];
        enableLogging: boolean;
        enablePlexLogging: boolean;
        enableForcePingLogging: boolean;
        termsAgree?: [];
        isPrivacyConsigned?: number;
        userArenaRegion: number;
        maintenanceInfo?: {
            category: string;
            country: string[];
            detailType: string;
            finishTime: string;
            gameServers: string[];
            os: string[];
            packages: {
                mk: string;
                pkg: string;
            }[];
            startTime: string;
            title: string;
            utc: string;
        };
        offerwall: {
            id: number;
            title: string;
        };
        useYoutubeRewardEvent: boolean;
        gpgCycle: number;
        eve: {
            domain: string;
            "g-api": string;
        };
        insign: {
            useSimpleSignup: number;
        };
    };
    errorText: string;
    errorDetail: string;
}

namespace Gamekee {
    export interface Index {
        code: number;
        msg: string;
        data: {
            module: Module;
            list: List[];
        }[];
        meta: {
            request_id: string
            trace_id: string
        };
    }

    export interface Module {
        id: number;
        game_id: number;
        name: string;
        status: number;
        type: number;
        sort: number;
        land_sort: number;
        updated_uid: number;
        updated_at: number;
    }

    export interface List {
        begin_at: number;
        count_down: number;
        created_at: number;
        creator_uid: number;
        description: string;
        end_at: number;
        game_id: number;
        id: number;
        importance: number;
        link_url: string;
        picture: string;
        pub_area: string;
        sort: number;
        title: string;
        updated_at: number;
    }

}