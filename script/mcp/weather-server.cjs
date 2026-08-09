/**
 * 测试用天气 MCP 服务（stdio）。
 * 数据源：wttr.in（免费、无需密钥）。Node ≥ 18（使用内置 fetch）。
 *
 * 接入方式（ai.json → bots.PlanaBot.chatbot.mcp.servers）：
 * {
 *   "name": "weather",
 *   "transport": "stdio",
 *   "command": "node",
 *   "args": ["script/mcp/weather-server.cjs"],
 *   "enabledTools": ["get_weather", "get_weather_forecast"]
 * }
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const server = new Server({ name: 'weather-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

const TIMEOUT_MS = 10000;

async function fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'curl/8.0' } });
        if (!res.ok) throw new Error(`wttr.in HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

/** 当前天气：温度/体感/湿度/风速 */
async function getWeather(city) {
    const j = await fetchJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`);
    const cur = j?.current_condition?.[0];
    if (!cur) throw new Error(`未查到「${city}」的天气数据`);
    const desc = cur.weatherDesc?.[0]?.value || '未知';
    return (
        `${city} 当前天气：${desc}；` +
        `温度 ${cur.temp_C}°C（体感 ${cur.FeelsLikeC}°C）；` +
        `湿度 ${cur.humidity}%；风速 ${cur.windspeedKmph} km/h`
    );
}

/** 未来 N 天预报（每天取中午时段的天气描述与最高/最低温） */
async function getWeatherForecast(city, days) {
    const n = Math.max(1, Math.min(Number(days) || 3, 7));
    const j = await fetchJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`);
    const list = (j?.weather || []).slice(0, n);
    if (!list.length) throw new Error(`未查到「${city}」的预报数据`);
    const lines = list.map((d) => {
        const noon = d.hourly?.[4]?.weatherDesc?.[0]?.value || '';
        return `${d.date}：${noon}，最高 ${d.maxtempC}°C / 最低 ${d.mintempC}°C`;
    });
    return `${city} 未来 ${n} 天预报：\n${lines.join('\n')}`;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'get_weather',
            description: '查询指定城市的当前天气（温度、体感、湿度、风速）',
            inputSchema: {
                type: 'object',
                properties: { city: { type: 'string', description: '城市名，如 上海 / Beijing' } },
                required: ['city'],
            },
        },
        {
            name: 'get_weather_forecast',
            description: '查询指定城市未来 N 天天气预报（默认 3 天，最多 7 天）',
            inputSchema: {
                type: 'object',
                properties: {
                    city: { type: 'string', description: '城市名，如 上海 / Beijing' },
                    days: { type: 'number', description: '预报天数 1-7，默认 3' },
                },
                required: ['city'],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
        let text;
        if (name === 'get_weather') text = await getWeather(String(args.city || ''));
        else if (name === 'get_weather_forecast')
            text = await getWeatherForecast(String(args.city || ''), Number(args.days));
        else throw new Error(`未知工具 ${name}`);
        return { content: [{ type: 'text', text }] };
    } catch (err) {
        return { content: [{ type: 'text', text: `查询失败：${err.message}` }], isError: true };
    }
});

(async () => {
    await server.connect(new StdioServerTransport());
})().catch((err) => {
    console.error('weather-mcp 启动失败:', err);
    process.exit(1);
});
