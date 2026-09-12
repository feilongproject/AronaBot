/**
 * 百炼 JSON Schema 模式仅部分模型支持：
 * Qwen3.7-Plus / Qwen3.7-Max / Qwen3.8-Max 系列。
 * @see https://help.aliyun.com/zh/model-studio/qwen-structured-output
 */
export function chatModelSupportsJsonSchema(model: string): boolean {
    const m = String(model || '').toLowerCase();
    return /qwen3\.8-max/.test(m) || /qwen3\.7-(plus|max)/.test(m);
}

export type StructuredOutputMode = 'off' | 'json_object' | 'json_schema';

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

/**
 * 结构化输出策略：
 * - 关闭：不传 response_format
 * - 模型支持 Schema：json_schema（严格结构）
 * - 其余：json_object（保证合法 JSON，结构靠 prompt）
 *
 * 看图：百炼文档「图片、视频数据处理」明确支持 JSON Object；
 * Qwen3.7-Plus/Max、Qwen3.8-Max 另支持 JSON Schema（可带图）。
 * @see https://help.aliyun.com/zh/model-studio/qwen-structured-output
 */
export function resolveStructuredOutputMode(opts: {
    structuredOutput: boolean;
    model: string;
}): StructuredOutputMode {
    if (!opts.structuredOutput) return 'off';
    if (chatModelSupportsJsonSchema(opts.model)) return 'json_schema';
    return 'json_object';
}
