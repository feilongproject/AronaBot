/**
 * 结构化输出模式：由配置项直选，不再按模型名筛选。
 * - off：不传 response_format，自由文本
 * - json_object：仅保证合法 JSON，结构靠 prompt
 * - json_schema：严格结构（上游拒绝时由调用方回落 json_object）
 *
 * @see https://help.aliyun.com/zh/model-studio/qwen-structured-output
 */
export type StructuredOutputMode = 'off' | 'json_object' | 'json_schema';

export const STRUCTURED_OUTPUT_MODES: readonly StructuredOutputMode[] = [
    'off',
    'json_object',
    'json_schema',
] as const;

/** 未配置时的默认模式 */
export const DEFAULT_STRUCTURED_OUTPUT_MODE: StructuredOutputMode = 'json_schema';

export function isStructuredOutputMode(v: unknown): v is StructuredOutputMode {
    return typeof v === 'string' && (STRUCTURED_OUTPUT_MODES as readonly string[]).includes(v);
}

/**
 * 归一化结构化输出模式（配置项直选）。
 * 兼容旧布尔字段：true → json_schema，false → off；非法/缺失 → fallback。
 */
export function normalizeStructuredOutputMode(
    raw: unknown,
    fallback: StructuredOutputMode = DEFAULT_STRUCTURED_OUTPUT_MODE,
): StructuredOutputMode {
    if (isStructuredOutputMode(raw)) return raw;
    if (typeof raw === 'boolean') return raw ? 'json_schema' : 'off';
    return fallback;
}

export const CHATBOT_USER_AGENT = 'PlanaBot-chatbot/1.0';

export function isOpenCodeZenEndpoint(baseURL: string): boolean {
    try {
        return /(^|\.)opencode\.ai$/i.test(new URL(baseURL).hostname);
    } catch {
        return /opencode\.ai/i.test(baseURL || '');
    }
}

/** OpenCode Go 要求每轮对话带稳定 session，并避免通用 SDK User-Agent */
export function chatOpenAIHeaders(
    baseURL: string,
    sessionId: string,
): Record<string, string> | undefined {
    if (!isOpenCodeZenEndpoint(baseURL)) return undefined;
    return {
        'User-Agent': CHATBOT_USER_AGENT,
        'x-opencode-session': String(sessionId || '').trim() || 'planabot',
    };
}
