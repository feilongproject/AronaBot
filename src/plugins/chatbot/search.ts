import axios, { AxiosError } from 'axios';
import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { ChatbotRuntimeConfig } from './config';

/**
 * DeepSeek 网页搜索与抓取（Search / Fetch 工具）。
 *
 * - Search: `POST {baseURL}/v1/tools/search`，参数 query / count / ori_question / need_content
 * - Fetch:  `POST {baseURL}/v1/tools/fetch`，参数 url，返回 Markdown 正文
 * - 鉴权：`Authorization: Bearer <apiKey>`；按成功请求计费（5 元 / 1000 次）
 *
 * @see https://api-docs.deepseek.com/zh-cn/guides/search
 */

export const SEARCH_TOOL_NAME = 'web_search';
export const FETCH_TOOL_NAME = 'web_fetch';

const SEARCH_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;
/** 408 / 429 / 5xx 可等待后重试（官方建议） */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const ITEM_SUMMARY_MAX = 500;
const ITEM_CONTENT_MAX = 800;

/**
 * Search/Fetch 接口根地址：baseURL 通常形如 https://api.deepseek.com 或 xx/v1，
 * 已带 /v1 后缀则直接拼接，否则补 /v1。
 */
export function deepseekToolsEndpoint(baseURL: string, api: 'search' | 'fetch'): string {
    const base =
        String(baseURL || '')
            .trim()
            .replace(/\/+$/, '') || 'https://api.deepseek.com';
    const root = /\/v1$/i.test(base) ? base : `${base}/v1`;
    return `${root}/tools/${api}`;
}

/** 当前配置下的搜索工具集；未启用或密钥缺失时返回空 */
export function getSearchTools(cfg: ChatbotRuntimeConfig): ChatCompletionTool[] {
    if (!cfg.search.enabled || !cfg.search.apiKey) return [];
    const tools: ChatCompletionTool[] = [
        {
            type: 'function',
            function: {
                name: SEARCH_TOOL_NAME,
                description:
                    '联网搜索实时网页信息（新闻、天气、赛事、版本更新、事实核查等），返回标题、链接与摘要。支持 site:、-site:、-、""、lang:、after:、before: 等搜索语法。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description:
                                '搜索词（1–128 字），可带搜索语法，如：DeepSeek V4 site:github.com lang:zh after:2026',
                        },
                    },
                    required: ['query'],
                },
            },
        },
    ];
    if (cfg.search.allowFetch) {
        tools.push({
            type: 'function',
            function: {
                name: FETCH_TOOL_NAME,
                description:
                    '抓取指定网页并返回 Markdown 正文，用于细读 web_search 结果中的链接；不要凭空猜测网页内容。',
                parameters: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: '要抓取的完整 http/https 链接' },
                    },
                    required: ['url'],
                },
            },
        });
    }
    return tools;
}

/** 判断工具名是否为内置搜索工具（区别于 MCP 工具） */
export function isSearchToolName(name: string): boolean {
    return name === SEARCH_TOOL_NAME || name === FETCH_TOOL_NAME;
}

interface SearchResultItem {
    rerank_score?: number;
    title?: string;
    url?: string;
    snippet?: string;
    summary?: string;
    content?: string;
    site_name?: string | null;
    date?: string | null;
    authority?: number;
}

function clip(s: unknown, n: number): string {
    const t = String(s ?? '')
        .trim()
        .replace(/\s+/g, ' ');
    return t.length > n ? `${t.slice(0, n)}…` : t;
}

function formatHttpError(err: unknown): string {
    if (err instanceof AxiosError) {
        const status = err.response?.status;
        const body = err.response?.data as { error?: { message?: string } } | string | undefined;
        const msg =
            typeof body === 'string'
                ? body.slice(0, 200)
                : body?.error?.message
                  ? String(body.error.message).slice(0, 200)
                  : err.message;
        return status ? `HTTP ${status} ${msg}` : err.message;
    }
    return err instanceof Error ? err.message : String(err);
}

/** 408/429/5xx 与网络错误按官方建议退避重试；其它 4xx 直接失败 */
async function postWithRetry(
    url: string,
    body: Record<string, unknown>,
    apiKey: string,
): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
        try {
            const { data } = await axios.post(url, body, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: SEARCH_TIMEOUT_MS,
                proxy: false,
            });
            return data;
        } catch (err) {
            const status = err instanceof AxiosError ? err.response?.status : undefined;
            const retryable = !status || RETRYABLE_STATUS.has(status);
            if (attempt >= MAX_RETRIES || !retryable) throw err;
            log.warn(`chatbot 搜索请求失败 HTTP ${status || '-'}，第 ${attempt + 1} 次重试`);
            await sleep(600 * (attempt + 1));
        }
    }
}

/** 搜索结果为紧凑文本（标题/链接/摘要），总长受 resultMaxChars 约束 */
function formatSearchResults(
    results: SearchResultItem[],
    maxChars: number,
    withContent: boolean,
): string {
    if (!results.length) return '（没有找到相关网页结果，可更换搜索词，或直接凭已有知识回答）';
    const lines: string[] = [`搜索结果（共 ${results.length} 条）：`];
    results.forEach((r, i) => {
        const title = clip(r.title, 100) || `结果 ${i + 1}`;
        const meta = [clip(r.site_name, 30), r.date ? String(r.date).slice(0, 10) : '']
            .filter(Boolean)
            .join(' · ');
        const row = [`${i + 1}. ${title}${meta ? `（${meta}）` : ''}`];
        if (r.url) row.push(`   链接: ${clip(r.url, 200)}`);
        const digest = clip(r.summary || r.snippet, ITEM_SUMMARY_MAX);
        if (digest) row.push(`   摘要: ${digest}`);
        if (withContent && r.content) row.push(`   正文片段: ${clip(r.content, ITEM_CONTENT_MAX)}`);
        lines.push(row.join('\n'));
    });
    const out = lines.join('\n');
    return out.length > maxChars ? `${out.slice(0, maxChars)}…（结果已截断）` : out;
}

function formatFetchResult(title: string, content: string, maxChars: number): string {
    const text = [clip(title, 100) ? `网页标题: ${clip(title, 100)}` : '', String(content).trim()]
        .filter(Boolean)
        .join('\n\n');
    if (!text) return '（页面没有可提取的正文）';
    return text.length > maxChars ? `${text.slice(0, maxChars)}…（正文已截断）` : text;
}

/**
 * 执行搜索 / 抓取工具；异常返回给模型的可读错误文本（不抛出，避免打断本轮回复）。
 * ori_question 传入触发搜索的用户原话，帮助搜索服务理解意图。
 */
export async function callSearchTool(
    cfg: ChatbotRuntimeConfig,
    name: string,
    argsText: string,
    oriQuestion = '',
): Promise<string> {
    let args: Record<string, unknown> = {};
    try {
        args = argsText ? (JSON.parse(argsText) as Record<string, unknown>) : {};
    } catch {
        args = {};
    }
    const maxChars = cfg.search.resultMaxChars;

    if (name === SEARCH_TOOL_NAME) {
        const query = String(args.query ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!query) return '[搜索失败] query 为空：请提供 1–128 字的搜索词';
        const body: Record<string, unknown> = {
            query: query.slice(0, 128),
            count: cfg.search.count,
            need_content: cfg.search.needContent,
        };
        const ori = String(oriQuestion || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 128);
        if (ori) body.ori_question = ori;

        const t0 = Date.now();
        try {
            const data = (await postWithRetry(
                deepseekToolsEndpoint(cfg.search.baseURL, 'search'),
                body,
                cfg.search.apiKey,
            )) as { results?: SearchResultItem[] };
            const results = Array.isArray(data?.results) ? data.results : [];
            log.info(
                `chatbot 联网搜索 "${clip(query, 50)}" → ${results.length} 条 ${Date.now() - t0}ms`,
            );
            return formatSearchResults(results, maxChars, cfg.search.needContent);
        } catch (err) {
            log.error(`chatbot 联网搜索失败 "${clip(query, 50)}": ${formatHttpError(err)}`);
            return `[搜索失败] ${formatHttpError(err)}；可稍后重试，或直接凭已有知识回答并说明可能过时`;
        }
    }

    if (name === FETCH_TOOL_NAME) {
        const url = String(args.url ?? '').trim();
        if (!/^https?:\/\/[^\s/]+/i.test(url)) {
            return '[抓取失败] url 无效：必须是含 host 的 http/https 完整链接';
        }
        const t0 = Date.now();
        try {
            const data = (await postWithRetry(
                deepseekToolsEndpoint(cfg.search.baseURL, 'fetch'),
                { url: url.slice(0, 8192) },
                cfg.search.apiKey,
            )) as { title?: string; content?: string };
            log.info(
                `chatbot 网页抓取 ${clip(url, 100)} → ${String(data?.content || '').length} 字 ${Date.now() - t0}ms`,
            );
            return formatFetchResult(
                String(data?.title || ''),
                String(data?.content || ''),
                maxChars,
            );
        } catch (err) {
            log.error(`chatbot 网页抓取失败 ${clip(url, 100)}: ${formatHttpError(err)}`);
            return `[抓取失败] ${formatHttpError(err)}`;
        }
    }

    return `[错误] 未找到工具 ${name}`;
}
