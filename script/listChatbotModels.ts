/**
 * 列出当前 chatbot 配置下可用的模型，并筛选具备图像识别（视觉理解）的模型。
 *
 * 数据源：
 *   - 对话：ai.json chatbot.baseURL + chatbot.apiKey（OpenAI 兼容 GET /models）
 *   - 看图：ai.json chatbot.visionBaseURL + visionApiKey
 *     · 百炼：GET /api/v1/models（含 capabilities / 输入模态）
 *     · 其余：OpenAI 兼容 GET /models，再按模型名启发式判断
 *
 * 图像识别判定：capabilities 含 VU（视觉理解）或 Multimodal-Omni；
 * 无目录元数据时回退到模型名启发式（vl / qvq / omni / ocr / vision / qwen3.5+ 等）。
 *
 * 额度：
 *   - 对话 DeepSeek：GET /user/balance（账户剩余人民币余额）
 *   - 看图百炼：GET /api/v1/models/limits（官方只返回限流上限 RPM/TPM，不含免费 Token 剩余量）
 *
 * 用法：
 *   pnpm list:chatbot-models
 *   pnpm list:chatbot-models -- --vision-only
 *   pnpm list:chatbot-models -- --json
 *   pnpm list:chatbot-models -- --all          # 打印全部可用模型（含无看图能力 / 目录未兼容）
 */
import fs from 'fs';
import path from 'path';
import axios, { AxiosError } from 'axios';

const ROOT = process.cwd();
const DEFAULT_CHAT_BASE = 'https://api.deepseek.com';
const DEFAULT_VISION_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

type AiJson = {
    chatbot?: {
        chatModel?: string;
        baseURL?: string;
        apiKey?: string;
        visionModel?: string;
        visionBaseURL?: string;
        visionApiKey?: string;
    };
};

type CatalogModel = {
    model: string;
    name?: string;
    description?: string;
    provider?: string;
    inference_provider?: string;
    capabilities?: string[];
    features?: string[];
    inference_metadata?: {
        request_modality?: string[];
        response_modality?: string[];
    };
    model_info?: {
        context_window?: number | null;
        max_input_tokens?: number | null;
        max_output_tokens?: number | null;
    };
};

type ListedModel = {
    id: string;
    source: 'chat' | 'vision';
    name: string;
    provider: string;
    capabilities: string[];
    requestModality: string[];
    responseModality: string[];
    contextWindow: number | null;
    callable: boolean;
    imageRecognition: boolean;
    imageReason: string;
    currentChat: boolean;
    currentVision: boolean;
    quotaText: string;
    quota?: ModelQuota;
};

type ModelQuota = {
    requestLimit: number | null;
    requestPeriodSec: number | null;
    usageLimit: number | null;
    usageField: string;
    usagePeriodSec: number | null;
};

type ChatBalance = {
    available: boolean;
    currency: string;
    total: string;
    granted: string;
    toppedUp: string;
};

function parseArgs(argv: string[]) {
    const flags = new Set<string>();
    for (const a of argv) {
        if (a === '--json') flags.add('json');
        else if (a === '--vision-only') flags.add('visionOnly');
        else if (a === '--chat-only') flags.add('chatOnly');
        else if (a === '--all') flags.add('all');
        else if (a === '--help' || a === '-h') flags.add('help');
        else {
            console.error(`未知参数: ${a}`);
            process.exit(1);
        }
    }
    return flags;
}

function printHelp() {
    console.log(
        [
            '列出当前 chatbot 可用模型，并筛选具备图像识别能力的模型。',
            '',
            '用法:',
            '  pnpm list:chatbot-models',
            '  pnpm list:chatbot-models -- --vision-only',
            '  pnpm list:chatbot-models -- --json',
            '  pnpm list:chatbot-models -- --all',
            '',
            '选项:',
            '  --vision-only   只打印具备图像识别的模型',
            '  --chat-only     只查对话端（apiKey / baseURL）',
            '  --json          JSON 输出',
            '  --all           额外打印全部可用模型；并包含目录中未出现在兼容 /models 的条目',
            '',
            '额度：DeepSeek 显示账户剩余余额；百炼显示官方限流限额（非免费 Token 余量）。',
        ].join('\n'),
    );
}

function trimSlash(s: string): string {
    return s.replace(/\/+$/, '');
}

function maskKey(key: string): string {
    if (!key) return '(空)';
    if (key.length <= 10) return `${key.slice(0, 2)}***`;
    return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function axiosErr(err: unknown): string {
    if (err instanceof AxiosError) {
        const status = err.response?.status;
        const body = err.response?.data;
        const msg =
            typeof body === 'string'
                ? body.slice(0, 200)
                : body && typeof body === 'object'
                  ? JSON.stringify(body).slice(0, 200)
                  : err.message;
        return status ? `HTTP ${status} ${msg}` : err.message;
    }
    return err instanceof Error ? err.message : String(err);
}

function toCompatModelsUrl(baseURL: string): string {
    const u = trimSlash(baseURL);
    return u.endsWith('/models') ? u : `${u}/models`;
}

/** 百炼兼容 base → 官方目录 GET /api/v1/models；非百炼返回 null */
function toDashscopeCatalogUrl(compatBase: string): string | null {
    const u = trimSlash(compatBase);
    if (!/dashscope(-intl)?\.aliyuncs\.com/i.test(u) && !/maas\.aliyuncs\.com/i.test(u)) {
        return null;
    }
    if (u.includes('/compatible-mode/')) {
        return u.replace(/\/compatible-mode\/v\d+$/i, '/api/v1/models');
    }
    if (/\/api\/v1\/models$/i.test(u)) return u;
    if (/\/api\/v1$/i.test(u)) return `${u}/models`;
    return null;
}

function toDashscopeLimitsUrl(catalogUrl: string): string {
    return catalogUrl.replace(/\/models$/i, '/models/limits');
}

function toDeepseekBalanceUrl(baseURL: string): string {
    const u = trimSlash(baseURL).replace(/\/v1$/i, '');
    return `${u}/user/balance`;
}

function numOrNull(v: unknown): number | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function fmtCount(n: number): string {
    if (n >= 100_000_000 && n % 100_000_000 === 0) return `${n / 100_000_000}亿`;
    if (n >= 10_000 && n % 10_000 === 0) return `${n / 10_000}万`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(n % 1000 === 0 ? 1 : 2)}万`;
    return String(n);
}

function fmtPeriod(sec: number | null): string {
    if (sec == null) return '';
    if (sec === 1) return '秒';
    if (sec === 60) return '分钟';
    return `${sec}s`;
}

function formatQuota(q: ModelQuota | undefined): string {
    if (!q) return '';
    const parts: string[] = [];
    if (q.requestLimit != null) {
        parts.push(`${fmtCount(q.requestLimit)}次/${fmtPeriod(q.requestPeriodSec)}`);
    }
    if (q.usageLimit != null) {
        const unit = q.usageField === 'total_tokens' || !q.usageField ? 'tok' : q.usageField;
        parts.push(`${fmtCount(q.usageLimit)}${unit}/${fmtPeriod(q.usagePeriodSec)}`);
    }
    return parts.join(' · ') || '无限制';
}

function formatBalance(b: ChatBalance): string {
    const unit = b.currency === 'CNY' ? '¥' : b.currency === 'USD' ? '$' : `${b.currency} `;
    return `余额 ${unit}${b.total}${b.available ? '' : '（不可用）'}`;
}

function asStrList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x || '').trim()).filter(Boolean);
}

/** 无目录元数据时的模型名启发式（仅作兜底） */
function heuristicImageReason(id: string): string | null {
    const s = id.toLowerCase();
    // qwen3.7-max 别名 = 2026-05-20 纯文本快照；带图会 400 Unexpected item type in content
    if (
        /embedding|rerank/.test(s) ||
        /^qwen3\.7-max(?:-preview|-2026-05-1[07]|-2026-05-20)?$/.test(s)
    ) {
        return null;
    }
    if (/(?:^|[/\-_])(?:vl|qvq|omni|ocr|vision|gui)(?:$|[/\-_.])/.test(s)) {
        return 'name-heuristic';
    }
    if (/qwen3\.(?:[5-9]|\d{2,})/.test(s)) {
        return 'name-heuristic:qwen3.5+';
    }
    return null;
}

function detectImageRecognition(input: {
    id: string;
    capabilities: string[];
    requestModality: string[];
    responseModality: string[];
    fromCatalog: boolean;
}): { yes: boolean; reason: string } {
    const caps = new Set(input.capabilities.map((c) => c.toUpperCase()));
    if (caps.has('VU')) return { yes: true, reason: 'capabilities:VU' };
    if (caps.has('MULTIMODAL-OMNI')) return { yes: true, reason: 'capabilities:Multimodal-Omni' };

    const req = new Set(input.requestModality.map((m) => m.toLowerCase()));
    const res = new Set(input.responseModality.map((m) => m.toLowerCase()));
    if (req.has('image') && res.has('text') && (caps.has('TG') || caps.has('REASONING'))) {
        return { yes: true, reason: 'request:Image+text-out' };
    }

    if (input.fromCatalog) return { yes: false, reason: '' };
    const h = heuristicImageReason(input.id);
    return h ? { yes: true, reason: h } : { yes: false, reason: '' };
}

async function fetchCompatIds(baseURL: string, apiKey: string): Promise<string[]> {
    const url = toCompatModelsUrl(baseURL);
    const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 20000,
        proxy: false,
    });
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list
        .map((x: { id?: string; model?: string }) => String(x?.id || x?.model || '').trim())
        .filter(Boolean);
}

async function fetchDashscopeCatalog(catalogUrl: string, apiKey: string): Promise<CatalogModel[]> {
    const all: CatalogModel[] = [];
    let page = 1;
    let total = Infinity;
    while (all.length < total) {
        const { data } = await axios.get(catalogUrl, {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            params: { page_no: page, page_size: 100, language: 'zh-CN' },
            timeout: 30000,
            proxy: false,
        });
        const out = data?.output;
        if (!out || !Array.isArray(out.models)) {
            throw new Error(`目录响应异常: ${JSON.stringify(data).slice(0, 300)}`);
        }
        total = Number(out.total) || out.models.length;
        all.push(...out.models);
        if (!out.models.length) break;
        page++;
        if (page > 50) break;
    }
    return all;
}

async function fetchDashscopeLimits(
    limitsUrl: string,
    apiKey: string,
): Promise<Map<string, ModelQuota>> {
    const map = new Map<string, ModelQuota>();
    let page = 1;
    let total = Infinity;
    while (map.size < total) {
        const { data } = await axios.get(limitsUrl, {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            params: { page_no: page, page_size: 100 },
            timeout: 30000,
            proxy: false,
        });
        const out = data?.output;
        const rows = Array.isArray(out?.quotas) ? out.quotas : [];
        total = Number(out?.total) || rows.length;
        for (const row of rows) {
            const id = String(row?.model || '').trim();
            const lim = row?.model_limit || {};
            if (!id) continue;
            map.set(id, {
                requestLimit: numOrNull(lim.request_limit),
                requestPeriodSec: numOrNull(lim.request_limit_period),
                usageLimit: numOrNull(lim.usage_limit),
                usageField: String(lim.usage_limit_field || ''),
                usagePeriodSec: numOrNull(lim.usage_limit_period),
            });
        }
        if (!rows.length) break;
        page++;
        if (page > 50) break;
    }
    return map;
}

async function fetchDeepseekBalance(baseURL: string, apiKey: string): Promise<ChatBalance> {
    const { data } = await axios.get(toDeepseekBalanceUrl(baseURL), {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        timeout: 15000,
        proxy: false,
    });
    const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
    const prefer =
        infos.find((x: { currency?: string }) => String(x?.currency) === 'CNY') || infos[0] || {};
    return {
        available: data?.is_available !== false,
        currency: String(prefer.currency || 'CNY'),
        total: String(prefer.total_balance ?? ''),
        granted: String(prefer.granted_balance ?? ''),
        toppedUp: String(prefer.topped_up_balance ?? ''),
    };
}

function toListed(
    id: string,
    source: 'chat' | 'vision',
    cat: CatalogModel | undefined,
    flags: { callable: boolean; currentChat: boolean; currentVision: boolean },
): ListedModel {
    const capabilities = asStrList(cat?.capabilities);
    const requestModality = asStrList(cat?.inference_metadata?.request_modality);
    const responseModality = asStrList(cat?.inference_metadata?.response_modality);
    const img = detectImageRecognition({
        id,
        capabilities,
        requestModality,
        responseModality,
        fromCatalog: !!cat,
    });
    return {
        id,
        source,
        name: cat?.name || id,
        provider: cat?.inference_provider || cat?.provider || '',
        capabilities,
        requestModality,
        responseModality,
        contextWindow: cat?.model_info?.context_window ?? null,
        callable: flags.callable,
        imageRecognition: img.yes,
        imageReason: img.reason,
        currentChat: flags.currentChat,
        currentVision: flags.currentVision,
        quotaText: '',
    };
}

function pad(s: string, n: number): string {
    const t = s.length > n ? `${s.slice(0, n - 1)}…` : s;
    return t.padEnd(n, ' ');
}

function printTable(models: ListedModel[]) {
    const header = [
        pad('ID', 36),
        pad('名称', 22),
        pad('看图', 6),
        pad('限额/额度', 32),
        pad('输入模态', 22),
        pad('能力', 22),
        '标记',
    ].join(' ');
    console.log(header);
    console.log('-'.repeat(header.length));
    for (const m of models) {
        const mark = [
            m.currentChat ? 'chat*' : '',
            m.currentVision ? 'vision*' : '',
            m.callable ? '' : '目录-未兼容列表',
        ]
            .filter(Boolean)
            .join(',');
        console.log(
            [
                pad(m.id, 36),
                pad(m.name, 22),
                pad(m.imageRecognition ? '是' : '否', 6),
                pad(m.quotaText || '-', 32),
                pad(m.requestModality.join(',') || '-', 22),
                pad(m.capabilities.join(',') || '-', 22),
                mark || '-',
            ].join(' '),
        );
    }
}

async function main() {
    const flags = parseArgs(process.argv.slice(2));
    if (flags.has('help')) {
        printHelp();
        return;
    }

    const aiPath = path.join(ROOT, 'config/ai.json');
    if (!fs.existsSync(aiPath)) {
        console.error('找不到 config/ai.json');
        process.exit(1);
    }
    const ai = JSON.parse(fs.readFileSync(aiPath, 'utf-8')) as AiJson;
    const chatKey = String(ai.chatbot?.apiKey || '').trim();
    const visionKey = String(ai.chatbot?.visionApiKey || '').trim();
    const chatBase = trimSlash(ai.chatbot?.baseURL || '') || DEFAULT_CHAT_BASE;
    const visionBase = trimSlash(ai.chatbot?.visionBaseURL || '') || DEFAULT_VISION_BASE;
    const currentChat = String(ai.chatbot?.chatModel || '').trim();
    const currentVision = String(ai.chatbot?.visionModel || '').trim();

    const wantChat = !flags.has('visionOnly');
    const wantVision = !flags.has('chatOnly');

    const models: ListedModel[] = [];
    const errors: string[] = [];
    let chatBalance: ChatBalance | null = null;
    let visionLimits = new Map<string, ModelQuota>();
    const meta: Record<string, unknown> = {
        chatBase,
        visionBase,
        currentChat,
        currentVision,
        chatKey: maskKey(chatKey),
        visionKey: maskKey(visionKey),
    };

    if (wantChat) {
        if (!chatKey) {
            errors.push('对话端: apiKey 为空，跳过');
        } else {
            try {
                const ids = await fetchCompatIds(chatBase, chatKey);
                for (const id of ids) {
                    models.push(
                        toListed(id, 'chat', undefined, {
                            callable: true,
                            currentChat: id === currentChat,
                            currentVision: false,
                        }),
                    );
                }
                meta.chatCount = ids.length;
            } catch (err) {
                errors.push(`对话端 ${chatBase}/models: ${axiosErr(err)}`);
            }
            try {
                chatBalance = await fetchDeepseekBalance(chatBase, chatKey);
                meta.chatBalance = chatBalance;
            } catch (err) {
                errors.push(`对话端余额 ${toDeepseekBalanceUrl(chatBase)}: ${axiosErr(err)}`);
            }
        }
    }

    if (wantVision) {
        if (!visionKey) {
            errors.push('看图端: visionApiKey 为空，跳过');
        } else {
            const catalogUrl = toDashscopeCatalogUrl(visionBase);
            let catalog = new Map<string, CatalogModel>();
            if (catalogUrl) {
                try {
                    const rows = await fetchDashscopeCatalog(catalogUrl, visionKey);
                    catalog = new Map(rows.map((r) => [r.model, r]));
                    meta.catalogUrl = catalogUrl;
                    meta.catalogTotal = rows.length;
                } catch (err) {
                    errors.push(`百炼目录 ${catalogUrl}: ${axiosErr(err)}`);
                }
                try {
                    visionLimits = await fetchDashscopeLimits(
                        toDashscopeLimitsUrl(catalogUrl),
                        visionKey,
                    );
                    meta.limitsTotal = visionLimits.size;
                } catch (err) {
                    errors.push(`百炼限额 ${toDashscopeLimitsUrl(catalogUrl)}: ${axiosErr(err)}`);
                }
            }

            try {
                const ids = await fetchCompatIds(visionBase, visionKey);
                const seen = new Set<string>();
                for (const id of ids) {
                    seen.add(id);
                    models.push(
                        toListed(id, 'vision', catalog.get(id), {
                            callable: true,
                            currentChat: false,
                            currentVision: id === currentVision,
                        }),
                    );
                }
                if (flags.has('all') && catalog.size) {
                    for (const [id, cat] of catalog) {
                        if (seen.has(id)) continue;
                        models.push(
                            toListed(id, 'vision', cat, {
                                callable: false,
                                currentChat: false,
                                currentVision: id === currentVision,
                            }),
                        );
                    }
                }
                meta.visionCompatCount = ids.length;
            } catch (err) {
                errors.push(`看图端 ${visionBase}/models: ${axiosErr(err)}`);
            }
        }
    }

    const uniq = new Map<string, ListedModel>();
    for (const m of models) {
        const key = `${m.source}:${m.id}`;
        const prev = uniq.get(key);
        if (!prev) {
            uniq.set(key, m);
            continue;
        }
        if (!prev.callable && m.callable) uniq.set(key, m);
    }
    let listed = [...uniq.values()].sort((a, b) => {
        if (a.imageRecognition !== b.imageRecognition) return a.imageRecognition ? -1 : 1;
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        return a.id.localeCompare(b.id);
    });
    if (flags.has('visionOnly')) listed = listed.filter((m) => m.imageRecognition);

    const applyQuota = (m: ListedModel) => {
        if (m.source === 'chat') {
            if (chatBalance) m.quotaText = formatBalance(chatBalance);
            return;
        }
        const q = visionLimits.get(m.id);
        if (q) {
            m.quota = q;
            m.quotaText = formatQuota(q);
        } else if (visionLimits.size) {
            m.quotaText = '无限额数据';
        }
    };
    for (const m of listed) applyQuota(m);

    const visionModels = listed.filter((m) => m.imageRecognition);
    const currentChatRow = listed.find((m) => m.currentChat);
    const currentVisionRow =
        listed.find((m) => m.currentVision) ||
        (currentVision
            ? (() => {
                  const row = toListed(currentVision, 'vision', undefined, {
                      callable: false,
                      currentChat: false,
                      currentVision: true,
                  });
                  applyQuota(row);
                  return row;
              })()
            : undefined);

    if (flags.has('json')) {
        console.log(
            JSON.stringify(
                {
                    config: meta,
                    errors,
                    counts: {
                        total: listed.length,
                        imageRecognition: visionModels.length,
                    },
                    current: {
                        chat: currentChatRow || { id: currentChat, imageRecognition: false },
                        vision: currentVisionRow || { id: currentVision, imageRecognition: false },
                    },
                    quota: {
                        chatBalance,
                        note: '百炼官方 /models/limits 只返回限流上限，不含免费 Token 剩余量',
                    },
                    models: listed,
                },
                null,
                2,
            ),
        );
        return;
    }

    console.log('=== chatbot 当前配置 ===');
    console.log(
        `对话  model=${currentChat || '-'}  base=${chatBase}  key=${chatKey ? '已配置' : '未配置'}`,
    );
    console.log(
        `      图像识别: ${currentChatRow?.imageRecognition ? '是' : '否'}` +
            (currentChatRow?.imageReason ? ` (${currentChatRow.imageReason})` : ''),
    );
    if (chatBalance) {
        const unit = chatBalance.currency === 'CNY' ? '¥' : `${chatBalance.currency} `;
        console.log(
            `      额度: ${chatBalance.available ? '可用' : '不可用'}  剩余 ${unit}${chatBalance.total}` +
                `  充值 ${unit}${chatBalance.toppedUp}  赠送 ${unit}${chatBalance.granted}`,
        );
    } else if (currentChatRow?.quotaText) {
        console.log(`      额度: ${currentChatRow.quotaText}`);
    }
    console.log(
        `看图  model=${currentVision || '-'}  base=${visionBase}  key=${visionKey ? '已配置' : '未配置'}`,
    );
    console.log(
        `      图像识别: ${currentVisionRow?.imageRecognition ? '是' : '否'}` +
            (currentVisionRow?.imageReason ? ` (${currentVisionRow.imageReason})` : ''),
    );
    if (currentVisionRow?.quotaText) {
        console.log(`      限额: ${currentVisionRow.quotaText}`);
    }
    if (currentVision && currentVisionRow && !currentVisionRow.imageRecognition) {
        console.log(
            '      ⚠ 当前 visionModel 不具备图像识别能力，chatbot 看图会失败或只能当文本模型用',
        );
    }
    if (typeof meta.catalogTotal === 'number') {
        console.log(`目录  ${meta.catalogUrl}  共 ${meta.catalogTotal} 条`);
    }
    if (visionLimits.size) {
        console.log(
            `限额  百炼 ${visionLimits.size} 个模型（官方只返回限流上限，免费 Token 余量见控制台）`,
        );
    }
    const callableCount = listed.filter((m) => m.callable).length;
    console.log(
        `合计  可用 ${callableCount} 个` +
            (flags.has('visionOnly') ? '' : `，其中图像识别 ${visionModels.length} 个`) +
            (flags.has('all') && listed.length !== callableCount
                ? `（含目录未兼容 ${listed.length - callableCount} 个）`
                : ''),
    );
    if (errors.length) {
        console.log('');
        console.log('=== 警告 ===');
        for (const e of errors) console.log(`- ${e}`);
    }

    if (!flags.has('visionOnly')) {
        const chatRows = listed.filter((m) => m.source === 'chat');
        if (chatRows.length) {
            console.log('');
            console.log(`=== 对话端可用模型 (${chatRows.length}) ===`);
            printTable(chatRows);
        }
        if (flags.has('all')) {
            const visionRows = listed.filter((m) => m.source === 'vision');
            if (visionRows.length) {
                console.log('');
                console.log(`=== 看图端全部模型 (${visionRows.length}) ===`);
                printTable(visionRows);
            }
        }
    }

    console.log('');
    console.log(`=== 具备图像识别能力 (${visionModels.length}) ===`);
    if (!visionModels.length) {
        console.log('(无)');
    } else {
        printTable(visionModels);
    }
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
});
