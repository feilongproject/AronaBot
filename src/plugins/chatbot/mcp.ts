import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { ChatbotRuntimeConfig } from './config';

interface McpConnection {
    serverName: string;
    client: Client;
    tools: { name: string; description?: string; inputSchema?: unknown }[];
}

let connections: McpConnection[] | null = null;
let connecting: Promise<McpConnection[]> | null = null;
let closed = false;

process.on('exit', () => {
    void closeMcpConnections();
});

function sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

/** 工具全名：serverName_toolName（OpenAI tool name 仅允许 [a-zA-Z0-9_-]） */
export function mcpToolName(serverName: string, toolName: string): string {
    return `${sanitize(serverName)}_${sanitize(toolName)}`;
}

async function createTransport(
    server: ChatbotMcpServerConfig,
): Promise<StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport> {
    switch (server.transport) {
        case 'stdio':
            if (!server.command) throw new Error('stdio transport 需要 command');
            return new StdioClientTransport({ command: server.command, args: server.args || [] });
        case 'http':
            if (!server.url) throw new Error('http transport 需要 url');
            return new StreamableHTTPClientTransport(new URL(server.url));
        case 'sse':
            if (!server.url) throw new Error('sse transport 需要 url');
            return new SSEClientTransport(new URL(server.url));
    }
}

/**
 * 惰性连接全部已配置 MCP server（失败单个不影响其余）。
 * 仅 mcpEnabled 且 servers 非空时生效；未配置时返回 []。
 */
export async function getMcpConnections(cfg: ChatbotRuntimeConfig): Promise<McpConnection[]> {
    if (!cfg.mcpEnabled || !cfg.mcpServers.length || closed) return [];
    if (connections) return connections;
    if (connecting) return connecting;
    connecting = (async () => {
        const list: McpConnection[] = [];
        for (const s of cfg.mcpServers) {
            try {
                const client = new Client({ name: 'AronaBotChatbot', version: '1.0.0' });
                await client.connect(await createTransport(s));
                const res = await client.listTools();
                const allowed = new Set(s.enabledTools || []);
                const filtered = (res.tools || []).filter(
                    (t) => !allowed.size || allowed.has(t.name),
                );
                list.push({
                    serverName: s.name,
                    client,
                    tools: filtered.map((t) => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema,
                    })),
                });
                log.info(
                    `chatbot MCP 已连接: ${s.name} (${filtered.length}/${(res.tools || []).length} tools)`,
                );
            } catch (err) {
                log.error(`chatbot MCP 连接失败: ${s.name}`, err);
            }
        }
        connections = list;
        return list;
    })().finally(() => {
        connecting = null;
    });
    return connecting;
}

/** 汇总为 OpenAI 兼容 tools（名称带 server 前缀，enabledTools 白名单已过滤） */
export async function getMcpTools(cfg: ChatbotRuntimeConfig): Promise<ChatCompletionTool[]> {
    const conns = await getMcpConnections(cfg);
    const out: ChatCompletionTool[] = [];
    for (const c of conns) {
        for (const t of c.tools) {
            out.push({
                type: 'function',
                function: {
                    name: mcpToolName(c.serverName, t.name),
                    description: t.description || `MCP 工具 ${c.serverName}.${t.name}`,
                    parameters: (t.inputSchema as Record<string, unknown>) || {
                        type: 'object',
                        properties: {},
                    },
                },
            });
        }
    }
    return out;
}

const TOOL_TIMEOUT_MS = 15000;
const RESULT_MAX_CHARS = 2000;

/** 执行单个 MCP 工具；结果序列化为文本（截断）；超时/异常返回错误文本而非抛出 */
export async function callMcpTool(
    cfg: ChatbotRuntimeConfig,
    fullName: string,
    argsText: string,
): Promise<string> {
    const conns = await getMcpConnections(cfg);
    for (const c of conns) {
        const tool = c.tools.find((t) => mcpToolName(c.serverName, t.name) === fullName);
        if (!tool) continue;
        let args: Record<string, unknown> = {};
        try {
            args = argsText ? JSON.parse(argsText) : {};
        } catch {
            args = { raw: argsText };
        }
        const timer = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('MCP 工具调用超时')), TOOL_TIMEOUT_MS),
        );
        const res = (await Promise.race([
            c.client.callTool({ name: tool.name, arguments: args }),
            timer,
        ])) as { content?: unknown[]; isError?: boolean } | null;
        const text = serializeMcpResult(res);
        return res?.isError ? `[工具错误] ${text}` : text;
    }
    return `[错误] 未找到工具 ${fullName}`;
}

function serializeMcpResult(res: { content?: unknown[] } | null): string {
    if (!res) return '空结果';
    const parts: string[] = [];
    for (const item of res.content || []) {
        const it = item as {
            type?: string;
            text?: string;
            data?: string;
            resource?: { uri?: string };
        };
        if (it.type === 'text') parts.push(String(it.text));
        else if (it.type === 'image') parts.push(`[图片结果 ${(it.data || '').length} 字符]`);
        else if (it.type === 'resource') parts.push(`[资源: ${it.resource?.uri || ''}]`);
        else parts.push(JSON.stringify(item).slice(0, 500));
    }
    return parts.join('\n').slice(0, RESULT_MAX_CHARS);
}

export async function closeMcpConnections(): Promise<void> {
    closed = true;
    const list = connections || [];
    connections = null;
    for (const c of list) {
        await c.client
            .close()
            .catch((err) => log.error(`chatbot MCP 关闭失败: ${c.serverName}`, err));
    }
}
