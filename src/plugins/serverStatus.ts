import fetch from "node-fetch";
import format from "date-format";
import { readFileSync } from "fs";
import { IMessageGUILD } from "../libs/IMessageEx";


export async function baServerStatus(msg: IMessageGUILD) {

    const jpStatus = fetch("https://d3656gtd9j62z1.cloudfront.net/prod/index.json").then(res => res.json()); // prod-noticeindex.bluearchiveyostar.com
    const globalStatus = fetch("https://d13o75oynjs6mz.cloudfront.net/sdk/enterToy.nx", { // https://m-api.nexon.com/sdk/enterToy.nx
        method: "POST",
        headers: {
            npparams: readFileSync(`${_path}/data/npparams`).toString(),
            acceptLanguage: "zh_TW",
            "X-Forwarded-For": "8.8.8.8",
        },
        body: readFileSync(`${_path}/data/getPromotion.nx`),
    }).then(res => res.json()).catch(err => {
        log.error(err);
        return { err };
    });

    return Promise.all([jpStatus, globalStatus]).then(([jpStatus, globalStatus]: [ServerStatusJP, ServerStatusGlobal]) => {
        // log.debug(json.Maintenance.StartDate)
        const jpEndTime = new Date(jpStatus.Maintenance.EndDate);
        const jpContent = (jpEndTime.getTime() + 1000 * 60 * 60 <= new Date().getTime()) ?
            "日服一切正常, 暂无官方维护通知(具体以游戏内提示为准)" :
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
            "国际服一切正常, 暂无官方维护通知(具体以游戏内提示为准)";

        return msg.sendMsgEx({ content: jpContent + "\n\n" + globalContent, });
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
