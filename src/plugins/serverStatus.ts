import axios from 'axios';
import format from 'date-format';
import { readFileSync } from 'fs';
import { IMessageC2C, IMessageDIRECT, IMessageGROUP, IMessageGUILD } from '../libs/IMessageEx';

export async function baServerStatus(
    msg: IMessageGUILD | IMessageDIRECT | IMessageGROUP | IMessageC2C,
) {
    const jpStatus = axios<ServerStatusJP>('https://d3656gtd9j62z1.cloudfront.net/prod/index.json')
        .then((res) => res.data)
        .catch((err) => log.error(err)); // prod-noticeindex.bluearchiveyostar.com

    const globalStatus = axios<ServerStatusGlobal>({
        // https://m-api.nexon.com/sdk/enterToy.nx
        url: 'https://d13o75oynjs6mz.cloudfront.net/sdk/enterToy.nx',
        method: 'POST',
        headers: {
            // npparams: readFileSync(`${_path}/data/npparams`).toString(),
            // acceptLanguage: "zh_TW",
            'X-Forwarded-For': '8.8.8.8',
        },
        data: readFileSync(`${_path}/data/getPromotion.nx`),
    })
        .then((res) => res.data)
        .catch((err) => log.error(err));

    const cnStatus = await axios<Gamekee.Index>({
        url: `https://www.gamekee.com/v1/wiki/indexV2`,
        headers: { 'game-alias': 'ba' },
    })
        .then((res) => res.data)
        .catch((err) => log.error(err));

    return Promise.all([jpStatus, globalStatus, cnStatus])
        .then(([jpStatus, globalStatus, cnStatus]) => {
            if (!jpStatus || !globalStatus || !cnStatus)
                return msg.sendMsgEx({ content: `网络连接失败，请稍后重试` });
            // log.debug(json.Maintenance.StartDate)
            const jpEndTime = new Date(jpStatus.Maintenance.EndDate);
            const jpMaintenance = jpEndTime.getTime() + 1000 * 60 * 60 > new Date().getTime();

            const globalInfo = globalStatus.result.maintenanceInfo;
            const globalStartTime = new Date(Number(globalInfo?.startTime || 0));
            const globalEndTime = new Date(Number(globalInfo?.finishTime || 0));

            const cnNode = Object.values(
                cnStatus.data.find((v) => v.module.name == '活动周历')?.list || {},
            )
                .flat(1)
                .filter((v) => v.pub_area == '国服')
                .find((v) => v.title.includes('国服维护'));
            const cnStartTime = new Date((cnNode?.begin_at || 0) * 1000);
            const cnEndTime = new Date((cnNode?.end_at || 0) * 1000);
            const cnMaintenance = !!cnNode && cnEndTime.getTime() > new Date().getTime();

            const servers: ServerInfo[] = [
                {
                    name: '日服',
                    maintenance: jpMaintenance,
                    startTime: jpStatus.Maintenance.StartDate,
                    endTime: jpStatus.Maintenance.EndDate,
                    extra: { label: '原因', text: jpStatus.Maintenance.Text },
                    extraInPlain: true,
                    note: '暂无官方维护通知',
                },
                {
                    name: '国际服',
                    maintenance: !!globalInfo,
                    startTime: format.asString(globalStartTime),
                    endTime: format.asString(globalEndTime),
                    plainSuffix: globalInfo ? globalStatus.errorText : undefined,
                    extra: globalInfo ? { label: '原因', text: globalInfo.title } : undefined,
                    extraInPlain: true,
                    note: '暂无官方维护通知',
                },
                {
                    name: '国服',
                    maintenance: cnMaintenance,
                    startTime: format.asString(cnStartTime),
                    endTime: format.asString(cnEndTime),
                    plainSuffix: cnMaintenance && cnNode ? cnNode.title : undefined,
                    extra:
                        cnMaintenance && cnNode
                            ? { label: '维护公告', text: cnNode.title }
                            : undefined,
                    extraInPlain: false,
                    note: '暂无维护通知（具体以游戏内提示为准）',
                },
            ];

            // 频道/频道私信保持纯文本；群聊与好友私聊在 allowMarkdown 时走 Markdown + LaTeX 色块
            if (!(msg instanceof IMessageGROUP || msg instanceof IMessageC2C) || !allowMarkdown)
                return msg.sendMsgEx({ content: renderPlainStatus(servers) });
            return msg.sendMarkdown({ content: renderMarkdownStatus(servers) });
        })
        .catch((err) => {
            log.error(err);
            return msg.sendMsgExRef({ content: `获取服务器状态时出错，请稍后重试` });
        });
}

/** 状态色块：只放机器人自己生成的短标签，外部公告文案一律不进公式 */
function statusBadge(maintenance: boolean): string {
    const bg = maintenance ? '#E74C3C' : '#16A085';
    const label = maintenance ? '维护中' : '正常';
    return `$\\colorbox{${bg}}{\\color{white}{\\textbf{ ${label} }}}$`;
}

/** 外部公告文案可能带 $ 或反斜杠，进 Markdown 正文前先去掉，避免误触发公式渲染 */
function escapeExternal(value: string): string {
    return value.replace(/[$\\]/g, '');
}

/** 群/好友：标题 + 状态色块 + 维护信息列表（降级去掉 $...$ 后正文仍可读） */
function renderMarkdownStatus(servers: ServerInfo[]): string {
    return servers
        .map((info) => {
            const lines = [`## ${info.name}`, statusBadge(info.maintenance)];
            if (info.maintenance) {
                lines.push(`- 开始维护时间: ${info.startTime}`);
                lines.push(`- 终止维护时间: ${info.endTime}`);
                if (info.extra)
                    lines.push(`- ${info.extra.label}: ${escapeExternal(info.extra.text)}`);
            } else {
                lines.push(info.note);
            }
            return lines.join('\n');
        })
        .join('\n\n');
}

/** 频道/频道私信及 Markdown 关闭时的纯文本，与旧版输出保持一致 */
function renderPlainStatus(servers: ServerInfo[]): string {
    return servers
        .map((info) => {
            if (!info.maintenance) return `${info.name}一切正常, ${info.note}`;
            const lines = [
                `${info.name}状态:${info.plainSuffix ? ` ${info.plainSuffix}` : ''}`,
                `开始维护时间: ${info.startTime}`,
                `终止维护时间: ${info.endTime}`,
            ];
            if (info.extra && info.extraInPlain)
                lines.push(`${info.extra.label}: ${info.extra.text}`);
            return lines.join('\n');
        })
        .join('\n\n');
}

interface ServerInfo {
    /** 服务器名称：日服 / 国际服 / 国服 */
    name: string;
    /** 是否处于维护状态 */
    maintenance: boolean;
    /** 开始维护时间 */
    startTime: string;
    /** 终止维护时间 */
    endTime: string;
    /** 正常状态下的补充说明 */
    note: string;
    /** 纯文本维护首行 `状态:` 后的附加文案（对齐旧版输出） */
    plainSuffix?: string;
    /** 附加行（原因/维护公告），外部文案，禁止进公式 */
    extra?: { label: string; text: string };
    /** 纯文本下是否输出附加行（旧版国服不单独输出标题行） */
    extraInPlain?: boolean;
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
            'g-api': string;
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
            request_id: string;
            trace_id: string;
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
