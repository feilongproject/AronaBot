import axios, { AxiosError } from 'axios';
import OpenAI from 'openai';
import sharp from 'sharp';

const DEFAULT_CHAT_BASE = 'https://api.deepseek.com';
const DEFAULT_VISION_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_CHAT_MODEL = 'deepseek-chat';
const DEFAULT_VISION_MODEL = 'qwen3.7-plus';

const PING_TIMEOUT_MS = 20000;
const PING_PROMPT = 'Reply with exactly the word pong.';

export type AIApiTestKind = 'chat' | 'vision';

export type AIApiTestInput = {
    kind: AIApiTestKind;
    baseURL?: string;
    apiKey?: string;
    model?: string;
};

export type AIApiTestResult = {
    ok: boolean;
    kind: AIApiTestKind;
    baseURL: string;
    model: string;
    message: string;
    ping: {
        ok: boolean;
        latencyMs: number;
        content: string;
        error?: string;
    };
    models: {
        ok: boolean;
        count: number;
        currentListed: boolean | null;
        sample: string[];
        error?: string;
    };
    balance?: {
        available: boolean;
        currency: string;
        total: string;
        granted: string;
        toppedUp: string;
    };
    warning?: string;
};

function trimSlash(s: string): string {
    return s.replace(/\/+$/, '');
}

function formatProviderError(err: unknown): string {
    if (err instanceof AxiosError) {
        const status = err.response?.status;
        const body = err.response?.data;
        const msg =
            typeof body === 'string'
                ? body.slice(0, 300)
                : body && typeof body === 'object'
                  ? JSON.stringify(body).slice(0, 300)
                  : err.message;
        return status ? `HTTP ${status} ${msg}` : err.message;
    }
    const o = err as {
        status?: number;
        message?: string;
        error?: { message?: string; code?: string };
    };
    const msg =
        o?.error?.message || o?.message || (err instanceof Error ? err.message : String(err));
    const code = o?.error?.code ? ` [${o.error.code}]` : '';
    return o?.status ? `HTTP ${o.status} ${msg}${code}` : `${msg}${code}`;
}

function visionTextOnlyHint(model: string, errText: string): string | undefined {
    const s = model.trim();
    const knownTextOnly = /^qwen3\.7-max(?:-preview|-2026-05-1[07]|-2026-05-20)?$/i.test(s);
    const unexpected = /Unexpected item type in content/i.test(errText);
    if (!knownTextOnly && !unexpected) return undefined;
    return `${s || '当前模型'} 不接受图片：qwen3.7-max 别名是纯文本（等于 2026-05-20 快照），看图请用 qwen3.7-plus 或 qwen3.7-max-2026-06-08`;
}

async function listCompatModels(baseURL: string, apiKey: string): Promise<string[]> {
    const url = `${trimSlash(baseURL)}/models`;
    const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: PING_TIMEOUT_MS,
        proxy: false,
    });
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list
        .map((x: { id?: string; model?: string }) => String(x?.id || x?.model || '').trim())
        .filter(Boolean);
}

async function fetchDeepseekBalance(
    baseURL: string,
    apiKey: string,
): Promise<AIApiTestResult['balance']> {
    const root = trimSlash(baseURL).replace(/\/v1$/i, '');
    const { data } = await axios.get(`${root}/user/balance`, {
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

async function tinyPngDataUrl(): Promise<string> {
    const buf = await sharp({
        create: {
            width: 32,
            height: 32,
            channels: 3,
            background: { r: 80, g: 160, b: 240 },
        },
    })
        .png()
        .toBuffer();
    return `data:image/png;base64,${buf.toString('base64')}`;
}

function summarize(result: Omit<AIApiTestResult, 'message'>): string {
    const pingText = result.ping.ok
        ? `模型 ${result.model} 已响应（${result.ping.latencyMs}ms）`
        : `调用失败：${result.ping.error || '无响应'}`;
    const modelsText = result.models.ok
        ? `目录 ${result.models.count} 个模型` +
          (result.models.currentListed == null
              ? ''
              : result.models.currentListed
                ? '，当前模型在列表中'
                : '，当前模型不在列表中')
        : result.models.error
          ? `目录查询失败：${result.models.error}`
          : '';
    const balanceText = result.balance
        ? `余额 ${result.balance.currency === 'CNY' ? '¥' : `${result.balance.currency} `}${result.balance.total}${result.balance.available ? '' : '（不可用）'}`
        : '';
    const head = result.ok
        ? result.kind === 'chat'
            ? '对话 API 可用'
            : '看图 API 可用'
        : result.kind === 'chat'
          ? '对话 API 失败'
          : '看图 API 失败';
    return [head, pingText, modelsText, balanceText, result.warning].filter(Boolean).join('。');
}

export async function testChatbotApi(input: AIApiTestInput): Promise<AIApiTestResult> {
    const kind = input.kind;
    const apiKey = String(input.apiKey || '').trim();
    const baseURL = trimSlash(
        String(input.baseURL || '').trim() ||
            (kind === 'chat' ? DEFAULT_CHAT_BASE : DEFAULT_VISION_BASE),
    );
    const model =
        String(input.model || '').trim() ||
        (kind === 'chat' ? DEFAULT_CHAT_MODEL : DEFAULT_VISION_MODEL);

    if (!apiKey) {
        const empty: AIApiTestResult = {
            ok: false,
            kind,
            baseURL,
            model,
            message: kind === 'chat' ? '对话 apiKey 为空' : '看图 visionApiKey 为空',
            ping: { ok: false, latencyMs: 0, content: '', error: '密钥未填写' },
            models: { ok: false, count: 0, currentListed: null, sample: [] },
        };
        return empty;
    }

    const openai = new OpenAI({
        apiKey,
        baseURL,
        timeout: PING_TIMEOUT_MS,
        maxRetries: 0,
    });

    const pingPromise = (async () => {
        const t0 = Date.now();
        try {
            const completion =
                kind === 'chat'
                    ? await openai.chat.completions.create({
                          model,
                          messages: [{ role: 'user', content: PING_PROMPT }],
                          max_tokens: 16,
                          temperature: 0,
                      })
                    : await openai.chat.completions.create({
                          model,
                          messages: [
                              {
                                  role: 'user',
                                  content: [
                                      { type: 'text', text: PING_PROMPT },
                                      {
                                          type: 'image_url',
                                          image_url: { url: await tinyPngDataUrl() },
                                      },
                                  ],
                              },
                          ],
                          max_tokens: 32,
                          temperature: 0,
                      });
            const content = String(completion.choices?.[0]?.message?.content || '').trim();
            return {
                ok: true,
                latencyMs: Date.now() - t0,
                content: content.slice(0, 200),
            };
        } catch (err) {
            return {
                ok: false,
                latencyMs: Date.now() - t0,
                content: '',
                error: formatProviderError(err),
            };
        }
    })();

    const modelsPromise = (async () => {
        try {
            const ids = await listCompatModels(baseURL, apiKey);
            return {
                ok: true,
                count: ids.length,
                currentListed: ids.includes(model),
                sample: ids.slice(0, 12),
            };
        } catch (err) {
            return {
                ok: false,
                count: 0,
                currentListed: null as boolean | null,
                sample: [] as string[],
                error: formatProviderError(err),
            };
        }
    })();

    const balancePromise =
        kind === 'chat' && /deepseek/i.test(baseURL)
            ? fetchDeepseekBalance(baseURL, apiKey).catch(() => undefined)
            : Promise.resolve(undefined);

    const [ping, models, balance] = await Promise.all([pingPromise, modelsPromise, balancePromise]);

    const warning = kind === 'vision' ? visionTextOnlyHint(model, ping.error || '') : undefined;
    const result: AIApiTestResult = {
        ok: ping.ok,
        kind,
        baseURL,
        model,
        message: '',
        ping,
        models,
        ...(balance ? { balance } : {}),
        ...(warning ? { warning } : {}),
    };
    result.message = summarize(result);
    return result;
}
