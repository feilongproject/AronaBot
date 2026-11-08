import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { decode as htmlDecode } from 'html-entities';
import { sendToAdmin } from '../libs/common';
import { IMessageC2C, IMessageGROUP, IMessageGUILD, MessageType } from '../libs/IMessageEx';
import config from '../../config/config';

/**
 * 推特（X）动态订阅与推送
 *
 * 数据源（默认免登录，经代理访问；GraphQL 主源 + syndication 备源，双源独立限流桶）：
 * - 主源 GraphQL: api.twitter.com（guest token 可轮换，50 次/窗口/token）
 *   - 激活 token: POST /1.1/guest/activate.json（公开 web bearer）
 *   - 账号 rest_id: GET /graphql/:qid/UserByScreenName（redis 缓存）
 *   - 时间线: GET /graphql/:qid/UserTweets（legacy 推文结构，含 RT/引用/长文 note_tweet）
 *   - 可配置 twitterPush.cookies（auth_token + ct0）走登录会话：部分账号（回复为主等）
 *     推文页对未登录访客不可见，guest 只能拿到空时间线，登录后可正常抓取
 * - 备源 syndication: /srv/timeline-profile/screen-name/:screen（__NEXT_DATA__ JSON，30 次/窗口/IP）
 * - 单推文: cdn.syndication.twimg.com/tweet-result?id=..&token=..
 * - 账号验证: api.fxtwitter.com/:screen → GraphQL → syndication 逐级回退
 *
 * 限流处理：429 时按 x-rate-limit-reset 写入对应源的 backoff（redis），窗口内直接跳过该源
 * 不发请求；GraphQL 429/token 失效先换新 token 重试一次（新 token = 新配额）；双源都不可用
 * 才提醒管理员（带冷却），恢复自动继续。
 *
 * 状态存储（Redis）：
 * - twitterPush:subscriptions     hash   field=小写screen_name → SubEntry JSON
 * - twitterPush:lastId:<screen>   string 各账号基线/最近已处理推文 id（雪花字符串）
 * - twitterPush:pushed            hash   field=<screen>:<tweetId> 防重复推送
 * - twitterPush:proxyUrl          string 运行时代理覆盖（优先于 config.twitterPush.proxyUrl）
 * - twitterPush:proxyDownNotified string 代理不可用已提醒标记（恢复时发恢复通知）
 * - twitterPush:notifyAt:<kind>   string 上次管理员提醒时间戳（冷却去重）
 * - twitterPush:guestToken        string guest token 缓存（TTL 2.5h，官方有效期 3h）
 * - twitterPush:restId            hash   field=小写screen_name → rest_id
 * - twitterPush:rl:<source>       string 数据源限流 backoff 截止时间戳(ms)，TTL 自动过期
 */

const SUB_HASH_KEY = 'twitterPush:subscriptions';
const PUSHED_HASH_KEY = 'twitterPush:pushed';
const LAST_ID_KEY = 'twitterPush:lastId:';
const PROXY_OVERRIDE_KEY = 'twitterPush:proxyUrl';
const PROXY_DOWN_KEY = 'twitterPush:proxyDownNotified';
const NOTIFY_AT_KEY = 'twitterPush:notifyAt:';
const GUEST_TOKEN_KEY = 'twitterPush:guestToken';
const RESTID_HASH_KEY = 'twitterPush:restId';
const RL_KEY = 'twitterPush:rl:';

/** Twitter Web 公开 bearer（网页端同款，多年稳定） */
const GUEST_BEARER =
    'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
/** GraphQL queryId（Twitter 改版会失效；404 时回退 syndication，可经 config 覆盖热修） */
const DEFAULT_QIDS = {
    UserByScreenName: 'k5XapwcSikNsEsILW5FvgA',
    UserTweets: 'E3opETHurmVJflFsUBVuUQ',
};
const UBSN_FEATURES = {
    hidden_profile_subscriptions_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_consumption_enabled: true,
    subscriptions_feature_can_gift_premium: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
};
const USERTWEETS_FEATURES = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_media_download_video_enabled: false,
    responsive_web_enhance_cards_enabled: false,
};

const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
/** 代理连通性探测目标：能拿到任意 HTTP 状态码即视为代理可用 */
const PROBE_URL = 'https://x.com';
/** 视频文件超过此大小跳过文件推送，仅发链接 */
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** 推文正文展示截断长度 */
const TEXT_MAX_LEN = 300;

/** 数据源限流（429）：resetAt 为 x-rate-limit-reset 秒级时间戳 */
class RateLimitError extends Error {
    resetAt?: number;
    constructor(source: string, resetAt?: number) {
        const waitMin = resetAt ? Math.max(1, Math.ceil((resetAt * 1000 - Date.now()) / 60000)) : 0;
        super(`${source} 被限流 (HTTP 429)${waitMin ? `，约 ${waitMin} 分钟后恢复` : ''}`);
        this.name = 'RateLimitError';
        this.resetAt = resetAt;
    }
}

/** guest token 失效（401/403），需重新激活 */
class TokenError extends Error {}
/** 账号/推文不存在（404 或 GraphQL errors: User not found） */
class AccountNotFoundError extends Error {}
/** 全部数据源不可用（各自原因见 message；rateLimited 标记是否全为限流/退避） */
class SourcesUnavailableError extends Error {
    rateLimited: boolean;
    constructor(reasons: string[], rateLimited: boolean) {
        super(reasons.join('；'));
        this.name = 'SourcesUnavailableError';
        this.rateLimited = rateLimited;
    }
}

// ---------------------------------------------------------------------------
// 配置与代理
// ---------------------------------------------------------------------------

function getPushConf(): ResolvedConf {
    const c = config.twitterPush || {};
    return {
        enable: c.enable ?? false,
        maxPushPerCheck: Math.max(1, c.maxPushPerCheck ?? 3),
        maxImagesPerTweet: Math.max(0, c.maxImagesPerTweet ?? 4),
        pushVideo: c.pushVideo ?? false,
        sourceBaseUrl: (c.sourceBaseUrl || '').trim() || 'https://syndication.twitter.com',
        apiBaseUrl: (c.apiBaseUrl || '').trim() || 'https://api.twitter.com',
        qidUserTweets: (c.userTweetsQueryId || '').trim() || DEFAULT_QIDS.UserTweets,
        qidUserByScreenName:
            (c.userByScreenNameQueryId || '').trim() || DEFAULT_QIDS.UserByScreenName,
        notifyCooldownMin: Math.max(1, c.notifyCooldownMin ?? 60),
        requestTimeout: Math.max(3000, c.requestTimeout ?? 15000),
        cookies: (c.cookies || '').trim(),
    };
}

/** 生效代理：运行时覆盖（redis）> settings.twitterPush.proxyUrl；空 = 直连 */
async function resolveProxyUrl(): Promise<string> {
    const override = await redis.get(PROXY_OVERRIDE_KEY);
    return (override || config.twitterPush?.proxyUrl || '').trim();
}

/** 校验代理 URL（仅 http/https；socks 不支持，需要时在服务器侧做端口转发） */
function validateProxyUrl(proxyUrl: string): URL {
    const u = new URL(proxyUrl);
    if (!/^https?:$/.test(u.protocol))
        throw new Error(`不支持的代理协议 ${u.protocol}（仅支持 http/https）`);
    return u;
}

/**
 * 代理 agent 缓存。
 * 注意：axios 内置 proxy 选项对 https 目标不做 CONNECT 隧道（明文绝对 URI 转发），
 * v2ray/xray 等本地代理不支持，会 400；统一走 https-proxy-agent。
 */
const proxyAgents = new Map<string, HttpsProxyAgent<string>>();

function getProxyAgent(proxyUrl: string): HttpsProxyAgent<string> {
    validateProxyUrl(proxyUrl);
    let agent = proxyAgents.get(proxyUrl);
    if (!agent) {
        agent = new HttpsProxyAgent(proxyUrl, { keepAlive: true });
        proxyAgents.set(proxyUrl, agent);
    }
    return agent;
}

/** axios 请求代理配置：proxy 置 false 屏蔽内置代理与 env 变量，有代理时挂隧道 agent；本机回环目标直连 */
function proxyConfig(targetUrl: string, proxyUrl: string) {
    if (!proxyUrl || isLoopbackUrl(targetUrl)) return { proxy: false as const };
    const agent = getProxyAgent(proxyUrl);
    return { proxy: false as const, httpAgent: agent, httpsAgent: agent };
}

function isLoopbackUrl(url: string): boolean {
    try {
        const h = new URL(url).hostname;
        return h === 'localhost' || h === '127.0.0.1' || h === '::1';
    } catch {
        return false;
    }
}

/** 展示用：抹掉代理 URL 中的账号密码 */
function maskProxyUrl(proxyUrl: string): string {
    if (!proxyUrl) return '';
    try {
        const u = new URL(proxyUrl);
        if (u.password) u.password = '***';
        if (u.username) u.username = '***';
        return u.toString().replace(/\/$/, '');
    } catch {
        return proxyUrl;
    }
}

/** 探测代理连通性：任意 HTTP 状态码 = 代理可用；连接层错误 = 代理不可用 */
async function probeProxy(
    proxyUrl: string,
    timeout: number,
): Promise<{ ok: boolean; detail: string }> {
    try {
        const res = await axios.get(PROBE_URL, {
            ...proxyConfig(PROBE_URL, proxyUrl),
            timeout: Math.min(timeout, 10000),
            validateStatus: () => true,
            maxRedirects: 0,
            headers: { 'User-Agent': userAgent },
        });
        return { ok: res.status < 500, detail: `HTTP ${res.status}` };
    } catch (err) {
        const e = err as { code?: string; message?: string };
        return { ok: false, detail: e?.code || e?.message || errMsg(err) };
    }
}

// ---------------------------------------------------------------------------
// 提醒（带冷却）
// ---------------------------------------------------------------------------

/** 群文本防 URL 检测：点号两侧插零宽字符（与旧 twitter.ts 一致） */
function sanitizeDots(s: string): string {
    return s.replaceAll('.', '\u200b.\u200b');
}

function errMsg(err: unknown): string {
    const e = err as { code?: string; message?: string };
    if (err instanceof Error) return err.message;
    if (e?.code) return String(e.code);
    if (e?.message) return String(e.message);
    return strFormat(err);
}

/** 同类提醒冷却窗口内只发一次；返回是否实际发送 */
async function notifyAdminCooldown(
    kind: string,
    content: string,
    cooldownMin: number,
): Promise<boolean> {
    const key = `${NOTIFY_AT_KEY}${kind}`;
    const last = Number(await redis.get(key)) || 0;
    if (Date.now() - last < cooldownMin * 60 * 1000) return false;
    await redis.set(key, Date.now().toString());
    await sendToAdmin(sanitizeDots(content));
    return true;
}

/** 代理不可用：日志 + 提醒管理员（冷却）；恢复后自动发恢复通知 */
async function handleProxyDown(
    proxyUrl: string,
    detail: string,
    conf: ResolvedConf,
    msg?: IMessageGUILD | IMessageGROUP | IMessageC2C,
) {
    log.error(`推特代理不可用: ${detail} (${maskProxyUrl(proxyUrl) || '直连'})`);
    const text =
        `推特动态推送：代理不可用，本轮检查已暂停\n` +
        `代理: ${maskProxyUrl(proxyUrl) || '(未配置，直连)'}\n` +
        `原因: ${detail}\n` +
        `恢复后将自动继续推送并通知`;
    if (msg) return msg.sendMsgEx({ content: sanitizeDots(text) });
    const sent = await notifyAdminCooldown('proxy', text, conf.notifyCooldownMin);
    if (sent) await redis.set(PROXY_DOWN_KEY, '1');
}

/** 代理恢复（此前发过不可用提醒才通知） */
async function handleProxyUp(proxyUrl: string) {
    if (!(await redis.get(PROXY_DOWN_KEY))) return;
    await redis.del(PROXY_DOWN_KEY);
    await sendToAdmin(
        sanitizeDots(
            `推特动态推送：代理已恢复 (${maskProxyUrl(proxyUrl) || '直连'})，继续正常检查`,
        ),
    );
}

// ---------------------------------------------------------------------------
// 数据源限流退避（429 时按 x-rate-limit-reset 记录，窗口内跳过该源不发请求）
// ---------------------------------------------------------------------------

type SourceKind = 'graphql' | 'syndication';

async function sourceBackoffUntil(source: SourceKind): Promise<number> {
    return Number(await redis.get(`${RL_KEY}${source}`)) || 0;
}

async function setSourceBackoff(source: SourceKind, resetAtSec?: number) {
    const until = resetAtSec ? resetAtSec * 1000 : Date.now() + 15 * 60 * 1000;
    const ttlSec = Math.max(60, Math.ceil((until - Date.now()) / 1000) + 60);
    const cur = await sourceBackoffUntil(source);
    if (until > cur) await redis.setEx(`${RL_KEY}${source}`, ttlSec, until.toString());
}

async function clearSourceBackoff(source: SourceKind) {
    await redis.del(`${RL_KEY}${source}`);
}

function fmtBackoff(until: number): string {
    return Math.max(1, Math.ceil((until - Date.now()) / 60000)) + ' 分钟';
}

// ---------------------------------------------------------------------------
// 数据源 1（主）：guest token / 登录 Cookie GraphQL —— 前 50 次/窗口/token，token 可轮换
// ---------------------------------------------------------------------------

/**
 * api.twitter.com 请求头：
 * - 配置了 cookies：走登录会话（x-csrf-token 取 ct0），可抓取对 guest 不可见的时间线
 * - 未配置：guest token（可轮换，新 token = 新配额）
 */
function twitterApiHeaders(token: string, conf: ResolvedConf): Record<string, string> {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${GUEST_BEARER}`,
        'User-Agent': userAgent,
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'zh-cn',
    };
    if (conf.cookies) {
        headers.Cookie = conf.cookies;
        headers['x-twitter-auth-type'] = 'OAuth2Session';
        const ct0 = /(?:^|;\s*)ct0=([^;]+)/.exec(conf.cookies)?.[1];
        if (ct0) headers['x-csrf-token'] = ct0;
    } else if (token) {
        headers['x-guest-token'] = token;
    }
    return headers;
}

/** 激活 guest token（redis 缓存 2.5h；force=强制换新，用于 429/失效轮换）；配置 cookies 时跳过 */
async function ensureGuestToken(
    proxyUrl: string,
    conf: ResolvedConf,
    force = false,
): Promise<string> {
    if (conf.cookies) return '';
    if (!force) {
        const cached = await redis.get(GUEST_TOKEN_KEY);
        if (cached) return cached;
    }
    const url = `${conf.apiBaseUrl.replace(/\/+$/, '')}/1.1/guest/activate.json`;
    const res = await axios.post(url, null, {
        ...proxyConfig(url, proxyUrl),
        timeout: conf.requestTimeout,
        headers: { Authorization: `Bearer ${GUEST_BEARER}`, 'User-Agent': userAgent },
        validateStatus: () => true,
    });
    if (res.status === 429)
        throw new RateLimitError(
            'guest token 激活',
            Number(res.headers['x-rate-limit-reset']) || undefined,
        );
    if (res.status !== 200 || !res.data?.guest_token)
        throw new Error(`guest token 激活失败 HTTP ${res.status}`);
    const token = String(res.data.guest_token);
    await redis.setEx(GUEST_TOKEN_KEY, Math.floor(2.5 * 3600), token);
    return token;
}

/** screen_name → rest_id（redis 缓存；顺带返回显示名/推文数供验证与可见性判断） */
async function ensureRestId(
    screenName: string,
    proxyUrl: string,
    conf: ResolvedConf,
    token: string,
): Promise<{ restId: string; name?: string; screenName?: string; statusesCount?: number }> {
    const field = screenName.toLowerCase();
    const cached = await redis.hGet(RESTID_HASH_KEY, field);
    if (cached) return { restId: cached };

    const url = `${conf.apiBaseUrl.replace(/\/+$/, '')}/graphql/${conf.qidUserByScreenName}/UserByScreenName`;
    const res = await axios.get(url, {
        params: {
            variables: JSON.stringify({ screen_name: screenName }),
            features: JSON.stringify(UBSN_FEATURES),
        },
        ...proxyConfig(url, proxyUrl),
        timeout: conf.requestTimeout,
        headers: twitterApiHeaders(token, conf),
        validateStatus: () => true,
    });
    if (res.status === 429)
        throw new RateLimitError(
            'GraphQL UserByScreenName',
            Number(res.headers['x-rate-limit-reset']) || undefined,
        );
    if (res.status === 401 || res.status === 403)
        throw new TokenError(`UserByScreenName 鉴权失败 HTTP ${res.status}`);
    const restId = res.data?.data?.user?.result?.rest_id as string | undefined;
    if (!restId) {
        const msg = res.data?.errors?.[0]?.message || '';
        if (res.status === 404 || /not found|could not find/i.test(msg))
            throw new AccountNotFoundError(`账号 @${screenName} 不存在`);
        throw new Error(`UserByScreenName 未返回 rest_id: ${msg || `HTTP ${res.status}`}`);
    }
    await redis.hSet(RESTID_HASH_KEY, field, restId);
    const userLegacy = res.data?.data?.user?.result?.legacy;
    return {
        restId,
        name: userLegacy?.name,
        screenName: userLegacy?.screen_name,
        statusesCount: Number(userLegacy?.statuses_count) || 0,
    };
}

/** UserTweets GraphQL → 统一 LegacyTweet[]（含置顶去重、RT/引用/长文展开） */
async function requestUserTweets(
    restId: string,
    token: string,
    proxyUrl: string,
    conf: ResolvedConf,
): Promise<LegacyTweet[]> {
    const url = `${conf.apiBaseUrl.replace(/\/+$/, '')}/graphql/${conf.qidUserTweets}/UserTweets`;
    const res = await axios.get(url, {
        params: {
            variables: JSON.stringify({
                userId: restId,
                count: 40,
                includePromotedContent: false,
                withQuickPromoteEligibilityTweetFields: false,
                withVoice: false,
                withV2Timeline: true,
            }),
            features: JSON.stringify(USERTWEETS_FEATURES),
        },
        ...proxyConfig(url, proxyUrl),
        timeout: conf.requestTimeout,
        headers: twitterApiHeaders(token, conf),
        validateStatus: () => true,
    });
    if (res.status === 429)
        throw new RateLimitError(
            'GraphQL UserTweets',
            Number(res.headers['x-rate-limit-reset']) || undefined,
        );
    if (res.status === 401 || res.status === 403)
        throw new TokenError(`UserTweets 鉴权失败 HTTP ${res.status}`);
    if (res.status === 404)
        throw new Error(
            `UserTweets queryId 无效 (HTTP 404)：数据源结构可能已更新，请更新 twitterPush.userTweetsQueryId`,
        );
    if (res.status !== 200) throw new Error(`UserTweets HTTP ${res.status}`);
    if (res.data?.errors?.length) {
        const msg = res.data.errors[0]?.message || JSON.stringify(res.data.errors[0]);
        if (/not found|could not find/i.test(msg)) throw new AccountNotFoundError(msg);
        throw new Error(`UserTweets errors: ${msg}`);
    }
    return parseUserTweets(res.data);
}

/** GraphQL result → LegacyTweet（core.user_results 取用户；长文优先 note_tweet 全文） */
function gqlToLegacy(result: any): LegacyTweet | null {
    if (!result || result.__typename === 'TweetTombstone') return null;
    if (result.__typename === 'TweetWithVisibilityResults') return gqlToLegacy(result.tweet);
    const legacy = result.legacy;
    if (!legacy?.id_str) return null;
    const userLegacy = result.core?.user_results?.result?.legacy;
    const note = result.note_tweet?.note_tweet_results?.result;
    return {
        id_str: legacy.id_str,
        // 长文推文 legacy.full_text 是截断版；用 note_tweet 全文时链接实体也要换成 note 的
        full_text: note?.text || legacy.full_text,
        created_at: legacy.created_at,
        entities: {
            ...legacy.entities,
            urls: note?.text ? note.entity_set?.urls || [] : legacy.entities?.urls,
        },
        extended_entities: legacy.extended_entities,
        user: { screen_name: userLegacy?.screen_name, name: userLegacy?.name },
        retweeted_status: (() => {
            const rt = legacy.retweeted_status_result?.result;
            return rt ? gqlToLegacy(rt) || undefined : undefined;
        })(),
        quoted_status: (() => {
            const q = result.quoted_status_result?.result;
            return q ? gqlToLegacy(q) || undefined : undefined;
        })(),
    };
}

function parseUserTweets(data: any): LegacyTweet[] {
    const instructions: any[] = data?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];
    const out: LegacyTweet[] = [];
    const seen = new Set<string>();
    const push = (t: LegacyTweet | null) => {
        if (t?.id_str && !seen.has(t.id_str)) {
            seen.add(t.id_str);
            out.push(t);
        }
    };
    for (const i of instructions) {
        if (i.type === 'TimelinePinEntry')
            push(gqlToLegacy(i.entry?.content?.itemContent?.tweet_results?.result));
        else if (i.type === 'TimelineAddEntries')
            for (const e of i.entries || [])
                if (e.content?.entryType === 'TimelineTimelineItem')
                    push(gqlToLegacy(e.content?.itemContent?.tweet_results?.result));
    }
    return out;
}

/** GraphQL 主源完整链路；token 失效/限流自动换新 token 重试一次（新 token = 新配额） */
async function fetchViaGraphQL(
    screenName: string,
    proxyUrl: string,
    conf: ResolvedConf,
): Promise<LegacyTweet[]> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const token = await ensureGuestToken(proxyUrl, conf, attempt > 0);
            const { restId } = await ensureRestId(screenName, proxyUrl, conf, token);
            return await requestUserTweets(restId, token, proxyUrl, conf);
        } catch (err) {
            lastErr = err;
            if (err instanceof TokenError && conf.cookies)
                throw new Error(
                    `Twitter cookies 失效或权限不足，请更新 twitterPush.cookies（${errMsg(err)}）`,
                );
            // cookies 模式无 guest token 可轮换，429 直接上抛交由退避/备源处理
            if (err instanceof RateLimitError && conf.cookies) throw err;
            if (err instanceof TokenError || err instanceof RateLimitError) {
                log.info(
                    `推特GraphQL 第${attempt + 1}次失败(${errMsg(err)})，轮换 guest token 重试`,
                );
                await redis.del(GUEST_TOKEN_KEY).catch(() => {});
                continue;
            }
            if (err instanceof AccountNotFoundError)
                await redis.hDel(RESTID_HASH_KEY, screenName.toLowerCase()); // 改名/注销后下轮重解析
            throw err;
        }
    }
    throw lastErr;
}

// ---------------------------------------------------------------------------
// 数据源 2（备）：syndication timeline-profile
// ---------------------------------------------------------------------------

/** 拉取账号时间线（syndication，约最近 20 条，含转推；404=账号不存在，429=限流） */
async function fetchTimeline(
    screenName: string,
    proxyUrl: string,
    timeout: number,
    sourceBase: string,
): Promise<LegacyTweet[]> {
    const url = `${sourceBase.replace(/\/+$/, '')}/srv/timeline-profile/screen-name/${encodeURIComponent(screenName)}`;
    const res = await axios.get(url, {
        ...proxyConfig(url, proxyUrl),
        timeout,
        headers: { 'User-Agent': userAgent, Referer: 'https://platform.twitter.com/' },
        validateStatus: () => true,
    });
    if (res.status === 429)
        throw new RateLimitError(
            'syndication',
            Number(res.headers['x-rate-limit-reset']) || undefined,
        );
    if (res.status === 404) throw new Error(`账号不存在或不可见 (HTTP 404)`);
    if (res.status !== 200) throw new Error(`timeline HTTP ${res.status}`);

    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const m = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(
        html,
    );
    if (!m) throw new Error('timeline 页面缺少 __NEXT_DATA__（数据源结构可能已变更）');
    const data = JSON.parse(m[1]);
    const entries: { content?: { tweet?: LegacyTweet } }[] =
        data?.props?.pageProps?.timeline?.entries || [];
    return entries
        .map((e) => e?.content?.tweet)
        .filter((t): t is LegacyTweet => Boolean(t?.id_str));
}

// ---------------------------------------------------------------------------
// 数据源编排：GraphQL 主源 → syndication 备源，各自限流退避
// ---------------------------------------------------------------------------

/**
 * 双源抓取时间线：优先 GraphQL（配额独立、token 可轮换），失败回退 syndication。
 * 单源 429 记录退避时间（窗口内后续轮次直接跳过该源，不发请求不刷屏）；
 * 双源都不可用抛 SourcesUnavailableError。
 */
async function fetchTweets(
    screenName: string,
    proxyUrl: string,
    conf: ResolvedConf,
): Promise<{ tweets: LegacyTweet[]; source: SourceKind }> {
    const now = Date.now();
    const reasons: string[] = [];
    let allRateLimited = true;

    const gqlUntil = await sourceBackoffUntil('graphql');
    if (gqlUntil > now) {
        reasons.push(`GraphQL 限流退避中（约 ${fmtBackoff(gqlUntil)}后恢复）`);
    } else {
        try {
            const tweets = await fetchViaGraphQL(screenName, proxyUrl, conf);
            await clearSourceBackoff('graphql');
            return { tweets, source: 'graphql' };
        } catch (err) {
            if (err instanceof RateLimitError) {
                await setSourceBackoff('graphql', err.resetAt);
                reasons.push(err.message);
            } else {
                allRateLimited = false;
                reasons.push(`GraphQL: ${errMsg(err)}`);
            }
            if (!(err instanceof AccountNotFoundError))
                log.error(`推特GraphQL 抓取失败，回退 syndication: ${errMsg(err)}`);
        }
    }

    const synUntil = await sourceBackoffUntil('syndication');
    if (synUntil > now) {
        reasons.push(`syndication 限流退避中（约 ${fmtBackoff(synUntil)}后恢复）`);
    } else {
        try {
            const tweets = await fetchTimeline(
                screenName,
                proxyUrl,
                conf.requestTimeout,
                conf.sourceBaseUrl,
            );
            await clearSourceBackoff('syndication');
            return { tweets, source: 'syndication' };
        } catch (err) {
            if (err instanceof RateLimitError) {
                await setSourceBackoff('syndication', err.resetAt);
                reasons.push(err.message);
            } else {
                allRateLimited = false;
                reasons.push(`syndication: ${errMsg(err)}`);
            }
            log.error(`推特syndication 抓取失败 @${screenName}: ${errMsg(err)}`);
        }
    }

    // 账号不存在等确定性错误直接上抛，不算数据源不可用
    throw new SourcesUnavailableError(reasons, allRateLimited);
}

/** 单条推文（tweet-result；token 为社区通用算法） */
async function fetchTweetById(
    tweetId: string,
    proxyUrl: string,
    timeout: number,
): Promise<TweetResultRaw> {
    const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    const url = `https://cdn.syndication.twimg.com/tweet-result`;
    const res = await axios.get(url, {
        params: { id: tweetId, token, lang: 'en' },
        ...proxyConfig(url, proxyUrl),
        timeout,
        headers: { 'User-Agent': userAgent },
        validateStatus: () => true,
    });
    if (res.status === 429)
        throw new RateLimitError(
            'tweet-result',
            Number(res.headers['x-rate-limit-reset']) || undefined,
        );
    if (res.status === 404) throw new Error(`推文不存在 (HTTP 404)`);
    if (res.status !== 200) throw new Error(`tweet-result HTTP ${res.status}`);
    if (!res.data?.id_str) throw new Error('tweet-result 返回空数据（推文可能被删除或受限）');
    return res.data as TweetResultRaw;
}

/**
 * 验证账号存在并取显示名：fxtwitter → GraphQL UserByScreenName → syndication 逐级回退
 * @throws 代理/网络不可用、限流等无法判定的错误
 */
async function verifyScreen(
    screen: string,
    proxyUrl: string,
    conf: ResolvedConf,
): Promise<{
    exists: boolean;
    displayName?: string;
    canonicalScreen?: string;
    statusesCount?: number;
}> {
    try {
        const fxUrl = `https://api.fxtwitter.com/${encodeURIComponent(screen)}`;
        const res = await axios.get(fxUrl, {
            ...proxyConfig(fxUrl, proxyUrl),
            timeout: conf.requestTimeout,
            headers: { 'User-Agent': userAgent },
            validateStatus: () => true,
            maxRedirects: 0,
        });
        if (res.status === 200 && res.data?.code === 200 && res.data?.user)
            return {
                exists: true,
                displayName: res.data.user.name,
                canonicalScreen: res.data.user.screen_name,
                statusesCount: Number(res.data.user.tweets) || 0,
            };
        if (res.status === 404 || res.status === 302) return { exists: false };
        throw new Error(`fxtwitter HTTP ${res.status}`);
    } catch (err) {
        log.error(`推特账号验证 fxtwitter 失败，回退 GraphQL 验证: ${errMsg(err)}`);
    }

    try {
        const token = await ensureGuestToken(proxyUrl, conf);
        const meta = await ensureRestId(screen, proxyUrl, conf, token);
        return {
            exists: true,
            displayName: meta.name,
            canonicalScreen: meta.screenName || screen,
            statusesCount: meta.statusesCount,
        };
    } catch (err) {
        if (err instanceof AccountNotFoundError) return { exists: false };
        log.error(`推特账号验证 GraphQL 失败，回退 syndication 验证: ${errMsg(err)}`);
    }

    try {
        const tweets = await fetchTimeline(
            screen,
            proxyUrl,
            conf.requestTimeout,
            conf.sourceBaseUrl,
        );
        const u = tweets[0]?.user;
        return {
            exists: true,
            displayName: u?.name,
            canonicalScreen: u?.screen_name || screen,
            statusesCount: tweets.length || undefined,
        };
    } catch (err) {
        if (err instanceof AccountNotFoundError || errMsg(err).includes('404'))
            return { exists: false };
        throw err;
    }
}

// ---------------------------------------------------------------------------
// 推文解析
// ---------------------------------------------------------------------------

/** 时间线 legacy 推文 → 统一结构（转推取内层内容与链接，外层账号做署名） */
function normalizeTimelineTweet(raw: LegacyTweet, fallbackScreen: string): ParsedTweet | null {
    if (!raw?.id_str) return null;
    const viaScreen = raw.user?.screen_name || fallbackScreen;
    const viaName = raw.user?.name || viaScreen;
    const isRetweet = Boolean(raw.retweeted_status);
    const t = raw.retweeted_status || raw;
    const authorScreen = t.user?.screen_name || viaScreen;

    const media = (t.extended_entities?.media || t.entities?.media || []) as LegacyMedia[];
    let text = htmlDecode(t.full_text || t.text || '');
    for (const m of media) if (m.url) text = text.replaceAll(m.url, '');
    for (const u of t.entities?.urls || [])
        text = text.replaceAll(u.url, htmlDecode(u.expanded_url || u.url));
    text = text.replace(/\s*https?:\/\/t\.co\/\S+\s*$/g, '').trim();

    const images = media
        .filter((m) => m.type === 'photo' && m.media_url_https)
        .map((m) => m.media_url_https as string);
    const vm = media.find((m) => m.type === 'video' || m.type === 'animated_gif');
    const videoUrl = vm ? pickBestMp4Legacy(vm.video_info?.variants) : undefined;

    return {
        dedupId: raw.id_str,
        id: t.id_str || raw.id_str,
        authorScreen,
        authorName: t.user?.name || authorScreen,
        viaScreen: isRetweet ? viaScreen : undefined,
        viaName: isRetweet ? viaName : undefined,
        text,
        link: `https://x.com/${authorScreen}/status/${t.id_str || raw.id_str}`,
        images,
        videoUrl,
        hasVideo: Boolean(vm),
        quotedSummary: buildQuotedSummary(
            t.quoted_status?.user?.screen_name,
            t.quoted_status ? htmlDecode(t.quoted_status.full_text || '') : undefined,
        ),
    };
}

/** tweet-result 单推文 → 统一结构 */
function normalizeTweetResult(d: TweetResultRaw): ParsedTweet | null {
    if (!d?.id_str) return null;
    const authorScreen = d.user?.screen_name || '';
    let text = htmlDecode(d.text || '');
    for (const u of d.entities?.urls || [])
        text = text.replaceAll(u.url, htmlDecode(u.expanded_url || u.url));
    for (const p of d.photos || []) if (p.url) text = text.replaceAll(p.url, '');
    text = text.replace(/\s*https?:\/\/t\.co\/\S+\s*$/g, '').trim();

    return {
        dedupId: d.id_str,
        id: d.id_str,
        authorScreen,
        authorName: d.user?.name || authorScreen,
        text,
        link: `https://x.com/${authorScreen}/status/${d.id_str}`,
        images: (d.photos || []).map((p) => p.url).filter(Boolean),
        videoUrl: d.video ? pickBestMp4Fx(d.video.variants) : undefined,
        hasVideo: Boolean(d.video),
        quotedSummary: buildQuotedSummary(
            d.quoted_tweet?.user?.screen_name,
            d.quoted_tweet ? htmlDecode(d.quoted_tweet.text || '') : undefined,
        ),
    };
}

function buildQuotedSummary(screen?: string, text?: string): string | undefined {
    if (!screen || !text) return undefined;
    const flat = text.replace(/\s+/g, ' ').trim();
    return `@${screen}: ${flat.length > 60 ? `${flat.slice(0, 60)}…` : flat}`;
}

/** legacy video_info.variants：取码率最高的 mp4 */
function pickBestMp4Legacy(
    variants?: { bitrate?: number; content_type?: string; url: string }[],
): string | undefined {
    const mp4 = (variants || []).filter((v) => (v.content_type || '').includes('mp4') && v.url);
    if (!mp4.length) return undefined;
    return mp4.reduce((a, b) => ((b.bitrate || 0) > (a.bitrate || 0) ? b : a)).url;
}

/** tweet-result video.variants：无码率字段时按 URL 中分辨率取最大 mp4 */
function pickBestMp4Fx(
    variants?: { type?: string; src?: string; bitrate?: number }[],
): string | undefined {
    const mp4 = (variants || []).filter((v) => (v.type || '').includes('mp4') && v.src);
    if (!mp4.length) return undefined;
    const weight = (v: { src?: string; bitrate?: number }) => {
        if (v.bitrate) return v.bitrate;
        const m = /\/(\d+)x(\d+)\//.exec(v.src || '');
        return m ? Number(m[1]) * Number(m[2]) : 0;
    };
    return mp4.reduce((a, b) => (weight(b) > weight(a) ? b : a)).src;
}

// ---------------------------------------------------------------------------
// 媒体下载 / COS / 推送
// ---------------------------------------------------------------------------

/** 图片取原图尺寸 */
function withOrigSize(url: string): string {
    return url.includes('?') ? url : `${url}?name=orig`;
}

async function downloadBuffer(url: string, proxyUrl: string, timeout: number): Promise<Buffer> {
    const res = await axios.get<ArrayBuffer>(url, {
        ...proxyConfig(url, proxyUrl),
        timeout,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': userAgent },
    });
    return Buffer.from(res.data);
}

/** 下载推文媒体并经 COS 中转；单个媒体失败仅跳过不中断 */
async function prepareMedia(
    parsed: ParsedTweet,
    proxyUrl: string,
    conf: ResolvedConf,
): Promise<{ imageKeys: string[]; videoKey?: string }> {
    const imageKeys: string[] = [];
    for (const [i, url] of parsed.images.entries()) {
        if (i >= conf.maxImagesPerTweet) break;
        try {
            const buf = await downloadBuffer(withOrigSize(url), proxyUrl, conf.requestTimeout);
            const ext = /\.png(\?|$)/i.test(url) ? 'png' : 'jpg';
            const key = `twitter/${parsed.id}-${i}.${ext}`;
            await cosPutObject({ Key: key, Body: buf, ContentLength: buf.length });
            imageKeys.push(key);
        } catch (err) {
            log.error(`推特媒体下载/上传失败 ${parsed.id}[${i}]: ${errMsg(err)}`);
        }
    }

    let videoKey: string | undefined;
    if (parsed.videoUrl && conf.pushVideo) {
        try {
            const buf = await downloadBuffer(parsed.videoUrl, proxyUrl, 60 * 1000);
            if (buf.length > VIDEO_MAX_BYTES) {
                log.info(
                    `推特视频超过 ${VIDEO_MAX_BYTES / 1024 / 1024}MB，跳过文件推送: ${parsed.link}`,
                );
            } else {
                const key = `twitter/${parsed.id}-video.mp4`;
                await cosPutObject({ Key: key, Body: buf, ContentLength: buf.length });
                videoKey = key;
            }
        } catch (err) {
            log.error(`推特视频下载/上传失败 ${parsed.id}: ${errMsg(err)}`);
        }
    }
    return { imageKeys, videoKey };
}

function buildPushText(
    parsed: ParsedTweet,
    prepared: { videoKey?: string },
    conf: ResolvedConf,
): string {
    let text = parsed.text;
    if (text.length > TEXT_MAX_LEN) text = `${text.slice(0, TEXT_MAX_LEN)}…（内容已截断）`;

    const head = parsed.viaScreen
        ? `${parsed.viaName} (@${parsed.viaScreen}) 转推了 ${parsed.authorName} (@${parsed.authorScreen})`
        : `${parsed.authorName} (@${parsed.authorScreen}) 发布了新推文`;

    const lines = [`${devEnv ? '[dev] ' : ''}${head}`, '', text];
    if (parsed.quotedSummary) lines.push('', `丨引用 ${parsed.quotedSummary}`);
    lines.push('', parsed.link);
    if (parsed.hasVideo && !prepared.videoKey && conf.pushVideo !== true)
        lines.push('（含视频，点击链接查看）');
    else if (parsed.hasVideo && !prepared.videoKey)
        lines.push('（含视频，文件过大或下载失败，点击链接查看）');
    return sanitizeDots(lines.join('\n'));
}

/** 群目标：groupMap 反查 openId + 最近 eventId 主动推送（与 biliDynamic 同路径） */
async function sendToGroupTarget(
    target: SubTarget,
    prepared: { imageKeys: string[]; videoKey?: string },
    text: string,
) {
    const openId = Object.entries(config.bots[botType].groupMap).find(
        ([, realId]) => realId == target.id,
    )?.[0];
    if (!openId) {
        log.error(`推特推送: 未在 groupMap 找到群 openId, uid=${target.id}`);
        return;
    }
    const eventId = await redis.get(`groupLastestEventId:${botType}:${openId}`);
    const msg = new IMessageGROUP(
        {
            group_id: openId,
            group_openid: openId,
            event_id: eventId || undefined,
            content: '',
            timestamp: new Date().toISOString(),
            author: { id: '', username: '', bot: true },
            message_scene: { source: 'twitterPush', ext: [] },
        } as any,
        false,
    );

    await msg.sendMsgEx({ content: text });
    for (const key of prepared.imageKeys) {
        await msg.sendMsgEx({ content: '', imageUrl: cosUrl(key) });
        await sleep(1000);
    }
    if (prepared.videoKey) {
        await msg.sendMsgEx({ content: '', fileUrl: cosUrl(prepared.videoKey, '') });
        await sleep(1000);
    }
}

/** 一条推文推给全部启用目标；单目标失败不影响其他目标 */
async function pushTweet(
    parsed: ParsedTweet,
    targets: SubTarget[],
    proxyUrl: string,
    conf: ResolvedConf,
) {
    const prepared = await prepareMedia(parsed, proxyUrl, conf);
    const text = buildPushText(parsed, prepared, conf);
    for (const target of targets) {
        if (!target.enable) continue;
        if (target.type !== MessageType.GROUP) {
            log.info(`推特推送: 暂不支持的目标类型 ${target.type}(${target.id})，跳过`);
            continue;
        }
        try {
            log.info(`推特推送 @${parsed.authorScreen} ${parsed.id} → 群(${target.id})`);
            await sendToGroupTarget(target, prepared, text);
        } catch (err) {
            log.error(`推特推送到群(${target.id})失败 ${parsed.id}:`, err);
        }
        await sleep(1200);
    }
}

// ---------------------------------------------------------------------------
// 订阅存储
// ---------------------------------------------------------------------------

async function getSubscriptions(): Promise<Record<string, SubEntry>> {
    const raw = await redis.hGetAll(SUB_HASH_KEY);
    const out: Record<string, SubEntry> = {};
    for (const [k, v] of Object.entries(raw || {})) {
        try {
            out[k] = JSON.parse(v) as SubEntry;
        } catch (err) {
            log.error(`推特订阅数据解析失败 ${k}: ${errMsg(err)}`);
        }
    }
    return out;
}

async function saveSubEntry(screenLower: string, entry: SubEntry | null) {
    if (!entry || !entry.targets.length) {
        await redis.hDel(SUB_HASH_KEY, screenLower);
        await redis.del(`${LAST_ID_KEY}${screenLower}`); // 全部退订后清基线，重新订阅不误推历史
    } else {
        await redis.hSet(SUB_HASH_KEY, screenLower, JSON.stringify(entry));
    }
}

// ---------------------------------------------------------------------------
// 定时主流程
// ---------------------------------------------------------------------------

/**
 * 定时检查入口（schedule.ts 每 5 分钟调用；/推特检查 手动触发时带 msg 反馈进度）
 */
export async function mainCheck(msg?: IMessageGUILD | IMessageGROUP | IMessageC2C) {
    if ((await redis.get('devEnv')) && !devEnv) return;
    const conf = getPushConf();
    if (!conf.enable) {
        if (msg)
            return msg.sendMsgEx({
                content: '推特动态推送未启用（settings.twitterPush.enable = false）',
            });
        return;
    }

    const subs = await getSubscriptions();
    const entries = Object.entries(subs).filter(([, e]) => e.targets.some((t) => t.enable));
    if (!entries.length) {
        if (msg) return msg.sendMsgEx({ content: '当前没有任何有效的推特订阅' });
        return;
    }

    const proxyUrl = await resolveProxyUrl();

    // 双源均在限流退避期：快速跳过本轮，不探测不发请求，避免浪费配额与重复提醒
    const now = Date.now();
    const gqlUntil = await sourceBackoffUntil('graphql');
    const synUntil = await sourceBackoffUntil('syndication');
    if (gqlUntil > now && synUntil > now) {
        const waitMin = Math.ceil((Math.min(gqlUntil, synUntil) - now) / 60000);
        const text = `推特动态推送：两个数据源均在限流退避中，本轮跳过，约 ${waitMin} 分钟后自动恢复检查`;
        log.info(text);
        if (msg) return msg.sendMsgEx({ content: sanitizeDots(text) });
        await notifyAdminCooldown('source', text, conf.notifyCooldownMin);
        return;
    }

    const probe = await probeProxy(proxyUrl, conf.requestTimeout);
    if (!probe.ok) return handleProxyDown(proxyUrl, probe.detail, conf, msg);
    await handleProxyUp(proxyUrl);

    if (msg)
        await msg
            .sendMsgEx({
                content: sanitizeDots(
                    `代理可用 (${probe.detail})，开始检查 ${entries.length} 个订阅账号…`,
                ),
            })
            .catch(() => {});

    const errors: string[] = [];
    const checks: string[] = [];
    let rateLimited = 0;
    let rateLimitMsg = '';
    let totalPushed = 0;
    for (const [key, entry] of entries) {
        try {
            const result = await checkAccount(key, entry, proxyUrl, conf, errors);
            totalPushed += result.pushed;
            checks.push(`@${entry.screenName}: ${result.note}`);
        } catch (err) {
            if (err instanceof SourcesUnavailableError) {
                if (err.rateLimited) {
                    rateLimited++;
                    rateLimitMsg = err.message;
                } else errors.push(`@${entry.screenName}: ${err.message}`);
            } else errors.push(`@${entry.screenName}: ${errMsg(err)}`);
            log.error(`推特检查 @${entry.screenName} 失败: ${errMsg(err)}`);
        }
        await sleep(2000);
    }

    if (rateLimited === entries.length) {
        const text =
            `推特动态推送：数据源全部被限流，本轮全部账号跳过\n${rateLimitMsg}\n` +
            '已写入退避，窗口结束自动恢复（期间不再重复请求）；guest token 已自动轮换，' +
            '若长期持续说明代理出口 IP 配额耗尽';
        log.error(text);
        if (msg) return msg.sendMsgEx({ content: sanitizeDots(text) });
        await notifyAdminCooldown('source', text, conf.notifyCooldownMin);
        return;
    }

    if (msg) {
        const summary =
            `检查完成：推送 ${totalPushed} 条（共 ${entries.length} 个订阅账号）` +
            (checks.length ? `\n${checks.join('\n')}` : '') +
            (rateLimited ? `，${rateLimited} 个账号被限流` : '') +
            (errors.length ? `\n失败:\n${errors.join('\n')}` : '');
        return msg.sendMsgEx({ content: sanitizeDots(summary) });
    }
    if (errors.length)
        await notifyAdminCooldown(
            'source',
            `推特动态抓取部分失败:\n${errors.join('\n')}`,
            conf.notifyCooldownMin,
        );
    if (totalPushed) log.info(`推特动态检查完成，推送 ${totalPushed} 条`);
}

/**
 * 检查单个账号：首轮只建基线不推历史；雪花 id 比较取增量；
 * 每轮最多 maxPushPerCheck 条（旧→新），失败也推进基线避免毒丸循环
 */
/** 单账号检查结果：推送条数 + 本轮状态说明 */
interface AccountCheckResult {
    pushed: number;
    note: string;
}

async function checkAccount(
    key: string,
    entry: SubEntry,
    proxyUrl: string,
    conf: ResolvedConf,
    errors: string[],
): Promise<AccountCheckResult> {
    const { tweets, source } = await fetchTweets(entry.screenName, proxyUrl, conf);
    const sorted = tweets.slice().sort((a, b) => (BigInt(a.id_str) < BigInt(b.id_str) ? -1 : 1));

    if (!sorted.length) {
        const note = conf.cookies
            ? '时间线返回 0 条（账号可能无公开推文）'
            : '时间线返回 0 条（该账号推文可能对未登录访客不可见，配置 twitterPush.cookies 后可抓取）';
        log.warn(`推特订阅 @${entry.screenName}: ${note}`);
        return { pushed: 0, note };
    }

    const lastId = await redis.get(`${LAST_ID_KEY}${key}`);
    if (!lastId) {
        const newest = sorted[sorted.length - 1];
        await redis.set(`${LAST_ID_KEY}${key}`, newest.id_str);
        log.info(
            `推特订阅 @${entry.screenName}: 初始化基线（数据源 ${source}），跳过 ${sorted.length} 条历史推文`,
        );
        return { pushed: 0, note: `初始化基线（${sorted.length} 条历史，数据源 ${source}）` };
    }

    const fresh = sorted.filter((t) => BigInt(t.id_str) > BigInt(lastId));
    if (!fresh.length) return { pushed: 0, note: '无新推文' };

    const toPush = fresh.slice(0, conf.maxPushPerCheck);
    if (fresh.length > toPush.length)
        log.info(
            `推特 @${entry.screenName}: 本轮新增 ${fresh.length} 条，超出上限仅推前 ${toPush.length} 条`,
        );

    let pushed = 0;
    for (const raw of toPush) {
        const parsed = normalizeTimelineTweet(raw, entry.screenName);
        if (!parsed) continue;
        const dedupField = `${key}:${parsed.dedupId}`;
        if (await redis.hExists(PUSHED_HASH_KEY, dedupField)) continue;
        try {
            await pushTweet(parsed, entry.targets, proxyUrl, conf);
            await redis.hSet(PUSHED_HASH_KEY, dedupField, Date.now().toString());
            pushed++;
        } catch (err) {
            errors.push(`@${entry.screenName} ${parsed.id}: ${errMsg(err)}`);
            log.error(`推特推送失败 @${entry.screenName} ${parsed.id}:`, err);
        }
        await redis.set(`${LAST_ID_KEY}${key}`, parsed.dedupId); // 失败也推进基线
        await sleep(3000);
    }
    return {
        pushed,
        note:
            `推送 ${pushed} 条（数据源 ${source}）` +
            (fresh.length > toPush.length ? `，积压 ${fresh.length - toPush.length} 条待下轮` : ''),
    };
}

// ---------------------------------------------------------------------------
// 命令入口（均需管理员）
// ---------------------------------------------------------------------------

function cleanContent(msg: { content: string }): string {
    return (msg.content || '').replace(/<@!?[A-Z0-9]*>/g, '').trim();
}

function isAdmin(msg: { author: { id: string } }): boolean {
    return adminId.includes(msg.author.id);
}

function noPermReply(msg: IMessageGUILD | IMessageGROUP | IMessageC2C) {
    return msg instanceof IMessageGUILD ? undefined : msg.sendMsgEx({ content: '无权限调用' });
}

/** /推特订阅 <用户名>：当前群订阅该账号（需 groupMap 已配置群号映射） */
export async function twitterSub(msg: IMessageGROUP) {
    if (!isAdmin(msg)) return noPermReply(msg);
    const arg = cleanContent(msg).match(/^\/?推特订阅\s+@?([A-Za-z0-9_]{1,15})$/i)?.[1];
    if (!arg)
        return msg.sendMsgEx({
            content: '用法: /推特订阅 <推特用户名>，如 /推特订阅 Blue_ArchiveJP',
        });

    const groupUid = config.bots[botType].groupMap[msg.group_id];
    if (!groupUid)
        return msg.sendMsgEx({
            content: '当前群未配置 groupMap 群号映射，无法定位推送目标；请联系主人配置后再试',
        });

    const conf = getPushConf();
    const proxyUrl = await resolveProxyUrl();
    await msg
        .sendMsgEx({
            content: sanitizeDots(
                `正在验证 @${arg} …（代理: ${maskProxyUrl(proxyUrl) || '直连'}）`,
            ),
        })
        .catch(() => {});

    let verify: {
        exists: boolean;
        displayName?: string;
        canonicalScreen?: string;
        statusesCount?: number;
    };
    try {
        verify = await verifyScreen(arg, proxyUrl, conf);
    } catch (err) {
        return msg.sendMsgEx({
            content: sanitizeDots(
                `验证账号失败: ${errMsg(err)}；请检查代理（/推特代理 状态）后重试`,
            ),
        });
    }
    if (!verify.exists) return msg.sendMsgEx({ content: `未找到推特账号 @${arg}` });

    // 订阅前探测时间线可见性：部分账号推文页对未登录访客不可见（guest 返回空），
    // 提前提示配置 twitterPush.cookies，避免订阅后一条推文都收不到
    let visibilityWarn = '';
    if (!conf.cookies && (verify.statusesCount ?? 0) > 0) {
        try {
            const probe = await fetchViaGraphQL(arg, proxyUrl, conf);
            if (!probe.length)
                visibilityWarn =
                    `\n⚠ 该账号时间线对未登录访客不可见（探测返回 0 条，账号实际有 ${verify.statusesCount} 条推文）\n` +
                    `可在 settings.twitterPush.cookies 配置登录 Cookie（auth_token 与 ct0）后重试，否则推送将为空`;
        } catch (err) {
            log.warn(`推特订阅可见性探测失败: ${errMsg(err)}`);
        }
    }

    const key = arg.toLowerCase();
    const subs = await getSubscriptions();
    const entry: SubEntry = subs[key] || {
        screenName: verify.canonicalScreen || arg,
        displayName: verify.displayName || '',
        targets: [],
    };
    if (verify.displayName) entry.displayName = verify.displayName;
    if (entry.targets.some((t) => t.type === MessageType.GROUP && t.id === groupUid))
        return msg.sendMsgEx({ content: `本群已订阅 @${entry.screenName}，无需重复订阅` });

    entry.targets.push({
        type: MessageType.GROUP,
        id: groupUid,
        name: `群(${groupUid})`,
        enable: true,
    });
    await saveSubEntry(key, entry);
    return msg.sendMsgEx({
        content: sanitizeDots(
            `已订阅 @${entry.screenName}${entry.displayName ? `（${entry.displayName}）` : ''} → 本群\n` +
                `首次检查仅建立基线不推送历史，之后新推文约 5 分钟内送达` +
                visibilityWarn,
        ),
    });
}

/** /推特取消订阅 <用户名>：当前群退订 */
export async function twitterUnsub(msg: IMessageGROUP) {
    if (!isAdmin(msg)) return noPermReply(msg);
    const arg = cleanContent(msg).match(
        /^\/?推特(?:取消订阅|退订)\s+@?([A-Za-z0-9_]{1,15})$/i,
    )?.[1];
    if (!arg) return msg.sendMsgEx({ content: '用法: /推特取消订阅 <推特用户名>' });

    const groupUid = config.bots[botType].groupMap[msg.group_id];
    const key = arg.toLowerCase();
    const subs = await getSubscriptions();
    const entry = subs[key];
    if (!entry || !groupUid) return msg.sendMsgEx({ content: `未找到本群对 @${arg} 的订阅` });

    const before = entry.targets.length;
    entry.targets = entry.targets.filter(
        (t) => !(t.type === MessageType.GROUP && t.id === groupUid),
    );
    if (entry.targets.length === before)
        return msg.sendMsgEx({ content: `本群未订阅 @${entry.screenName}` });

    await saveSubEntry(key, entry);
    return msg.sendMsgEx({
        content: `已取消本群对 @${entry.screenName} 的订阅${entry.targets.length ? `（其余 ${entry.targets.length} 个目标不受影响）` : ''}`,
    });
}

/** /推特订阅列表：查看所有订阅与当前代理状态 */
export async function twitterList(msg: IMessageGUILD | IMessageGROUP | IMessageC2C) {
    if (!isAdmin(msg)) return noPermReply(msg);
    const subs = await getSubscriptions();
    const conf = getPushConf();
    const proxyUrl = await resolveProxyUrl();
    const keys = Object.keys(subs);

    const lines = [
        `推特订阅列表（${keys.length} 个账号）`,
        `推送开关: ${conf.enable ? '已启用' : '未启用'}；代理: ${maskProxyUrl(proxyUrl) || '(直连)'}`,
    ];
    for (const k of keys) {
        const e = subs[k];
        lines.push(`▸ ${e.displayName ? `${e.displayName} ` : ''}@${e.screenName}`);
        for (const t of e.targets)
            lines.push(`  - [${t.type}] ${t.name || t.id}${t.enable ? '' : '（已停用）'}`);
    }
    return msg.sendMsgEx({ content: sanitizeDots(lines.join('\n')) });
}

/** /推特代理 [url|重置|状态]：查看连通性 / 运行时设置代理（redis 覆盖，优先于配置文件） */
export async function twitterProxy(msg: IMessageGUILD | IMessageGROUP | IMessageC2C) {
    if (!isAdmin(msg)) return noPermReply(msg);
    const sub = cleanContent(msg)
        .replace(/^\/?推特代理/, '')
        .trim();
    const conf = getPushConf();

    if (!sub || sub === '状态') {
        const override = await redis.get(PROXY_OVERRIDE_KEY);
        const confUrl = (config.twitterPush?.proxyUrl || '').trim();
        const effective = (override || confUrl).trim();
        const probe = await probeProxy(effective, conf.requestTimeout);
        const subs = await getSubscriptions();
        const lines = [
            `当前代理: ${maskProxyUrl(effective) || '(未配置，直连)'}`,
            `来源: ${override ? '运行时设置 (redis)' : confUrl ? 'settings.twitterPush.proxyUrl' : '无'}`,
            `连通性: ${probe.ok ? `可用 (${probe.detail})` : `不可用 (${probe.detail})`}`,
            `推送开关: ${conf.enable ? '已启用' : '未启用'}；订阅数: ${Object.keys(subs).length}`,
            override ? '发送 /推特代理 重置 可恢复使用配置文件值' : '',
        ];
        return msg.sendMsgEx({ content: sanitizeDots(lines.filter(Boolean).join('\n')) });
    }

    if (sub === '重置' || sub.toLowerCase() === 'reset') {
        await redis.del(PROXY_OVERRIDE_KEY);
        const confUrl = (config.twitterPush?.proxyUrl || '').trim();
        return msg.sendMsgEx({
            content: sanitizeDots(
                `已清除运行时代理设置，回落为配置文件值: ${maskProxyUrl(confUrl) || '(未配置，直连)'}`,
            ),
        });
    }

    try {
        validateProxyUrl(sub);
    } catch {
        return msg.sendMsgEx({
            content:
                '代理 URL 无效，示例: http://127.0.0.1:10809（仅支持 http/https 代理，可带账号密码）',
        });
    }

    await redis.set(PROXY_OVERRIDE_KEY, sub);
    const probe = await probeProxy(sub, conf.requestTimeout);
    if (probe.ok) await handleProxyUp(sub);
    return msg.sendMsgEx({
        content: sanitizeDots(
            `代理已设置为 ${maskProxyUrl(sub)}\n连通性: ${
                probe.ok
                    ? `可用 (${probe.detail})`
                    : `不可用 (${probe.detail})，请确认代理服务已启动`
            }`,
        ),
    });
}

/** /推特推送 <推文链接或ID>：立即抓取单条推文并推送到当前会话（测试用） */
export async function twitterPushById(msg: IMessageGROUP | IMessageC2C) {
    if (!isAdmin(msg)) return noPermReply(msg);
    const arg = cleanContent(msg).match(/^\/?推特推送\s+(\S+)$/)?.[1] || '';
    const tweetId = /(\d{5,25})/.exec(arg)?.[1];
    if (!tweetId) return msg.sendMsgEx({ content: '用法: /推特推送 <推文链接或ID>' });

    const conf = getPushConf();
    const proxyUrl = await resolveProxyUrl();
    try {
        const raw = await fetchTweetById(tweetId, proxyUrl, conf.requestTimeout);
        const parsed = normalizeTweetResult(raw);
        if (!parsed) return msg.sendMsgEx({ content: '未能解析该推文（可能已删除或为受限内容）' });

        const prepared = await prepareMedia(parsed, proxyUrl, conf);
        await msg.sendMsgEx({ content: buildPushText(parsed, prepared, conf) });
        for (const key of prepared.imageKeys) {
            await msg.sendMsgEx({ content: '', imageUrl: cosUrl(key) });
            await sleep(1000);
        }
        if (prepared.videoKey)
            await msg.sendMsgEx({ content: '', fileUrl: cosUrl(prepared.videoKey, '') });
    } catch (err) {
        log.error('推特推送测试失败:', err);
        return msg.sendMsgEx({
            content: sanitizeDots(
                `推送失败: ${errMsg(err)}（代理: ${maskProxyUrl(proxyUrl) || '直连'}）`,
            ),
        });
    }
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface ResolvedConf {
    enable: boolean;
    maxPushPerCheck: number;
    maxImagesPerTweet: number;
    pushVideo: boolean;
    sourceBaseUrl: string;
    apiBaseUrl: string;
    qidUserTweets: string;
    qidUserByScreenName: string;
    notifyCooldownMin: number;
    requestTimeout: number;
    cookies: string;
}

interface SubTarget {
    type: MessageType;
    /** GROUP: groupMap 中的群真实 uid；其他类型预留 */
    id: string;
    name: string;
    enable: boolean;
}

interface SubEntry {
    /** 规范大小写的 screen_name（API 返回） */
    screenName: string;
    displayName?: string;
    targets: SubTarget[];
}

interface ParsedTweet {
    /** 时间线外层 id（转推时为转推条 id），用于去重与基线 */
    dedupId: string;
    /** 展示用推文 id（转推时为内层原推） */
    id: string;
    authorScreen: string;
    authorName: string;
    /** 转推来源（订阅账号）署名 */
    viaScreen?: string;
    viaName?: string;
    text: string;
    link: string;
    images: string[];
    videoUrl?: string;
    hasVideo: boolean;
    quotedSummary?: string;
}

interface LegacyMedia {
    type: 'photo' | 'video' | 'animated_gif';
    url?: string;
    media_url_https?: string;
    video_info?: { variants?: { bitrate?: number; content_type?: string; url: string }[] };
}

interface LegacyTweet {
    id_str: string;
    full_text?: string;
    text?: string;
    created_at?: string;
    user?: { screen_name?: string; name?: string };
    entities?: { urls?: { url: string; expanded_url?: string }[]; media?: LegacyMedia[] };
    extended_entities?: { media?: LegacyMedia[] };
    retweeted_status?: LegacyTweet;
    quoted_status?: LegacyTweet;
}

interface TweetResultRaw {
    id_str: string;
    text?: string;
    created_at?: string;
    user?: { screen_name?: string; name?: string };
    entities?: { urls?: { url: string; expanded_url?: string }[] };
    photos?: { url: string }[];
    video?: { variants?: { type?: string; src?: string; bitrate?: number }[] };
    quoted_tweet?: { text?: string; user?: { screen_name?: string } };
}
