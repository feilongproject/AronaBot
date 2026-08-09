<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { fetchConfig, saveConfig, schemaDescription, type SettingsMeta } from '../api';
import BotEditor, { type BotConfigModel } from './BotEditor.vue';
import AIConfigEditor from './AIConfigEditor.vue';
import StickerLibrary from './StickerLibrary.vue';
import Field from './fields/Field.vue';
import TextInput from './fields/TextInput.vue';
import NumberInput from './fields/NumberInput.vue';
import BoolInput from './fields/BoolInput.vue';
import TextareaInput from './fields/TextareaInput.vue';
import PathField from './fields/PathField.vue';

const emit = defineEmits<{
    logout: [];
}>();

type AnyConfig = Record<string, any>;

const SECTIONS = [
    { id: 'webSettings', label: 'Web 设置', desc: '设置页开关与访问口令' },
    { id: 'bots', label: 'Bots', desc: '各机器人身份、端口、intent' },
    { id: 'ai', label: 'AI 配置', desc: '独立 ai.json：dsKey / chatbot' },
    { id: 'sticker', label: '表情图库', desc: 'chatbot 图库：隐藏/恢复/拒绝/删除' },
    { id: 'redis', label: 'Redis', desc: '缓存与状态存储' },
    { id: 'mariadb', label: 'MariaDB', desc: '业务持久化' },
    { id: 'mongo', label: 'MongoDB', desc: '双写持久化' },
    { id: 'cos', label: '腾讯 COS', desc: '图片上传' },
    { id: 'paths', label: '路径与通用', desc: '全局 rootPath + 子路径' },
    { id: 'images', label: '图片资源', desc: '出图子路径' },
    { id: 'aiTranslate', label: 'AI 翻译', desc: '模型与 few-shot' },
    { id: 'sms', label: '短信 SMS', desc: '阿里云短信' },
    { id: 'baiduCensoring', label: '百度审核', desc: '内容安全' },
    { id: 'groupPush', label: '群推送', desc: 'groupPush 接口' },
    { id: 'onebot', label: 'OneBot', desc: 'llob / OneBot 路径' },
    { id: 'hotLoad', label: '热加载', desc: '热更新模块列表' },
    { id: 'advanced', label: '高级 / JSON', desc: 'initConfig、Schema 与整文件 JSON' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const config = reactive<AnyConfig>({
    webSettings: { enabled: true, token: '' },
    rootPath: '',
    bots: {},
    redis: { socket: { host: '127.0.0.1', port: 6379 }, password: '', database: 0 },
    mariadb: {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        connectTimeout: 5000,
        connectionLimit: 100,
    },
    mongo: {
        host: '127.0.0.1',
        port: 27017,
        connectTimeoutMS: 5000,
        serverSelectionTimeoutMS: 5000,
    },
    cos: { SecretId: '', SecretKey: '', Bucket: '', Region: '' },
    groupPush: { url: '', authKey: '', appId: '', llobKey: '' },
    onebot: { baseUrl: '', localUploadPath: '', remoteUploadPath: '' },
    sms: {
        AccessKey: { AccessKeyId: '', AccessKeySecret: '' },
        sendInfo: { phone: 0, sign: '', template: '' },
    },
    baiduCensoring: { APP_ID: '', API_KEY: '', SECRET_KEY: '' },
    images: {
        gachaMask: ['', '', '', ''],
        characters: '',
        accuseCharacters: '',
        firstChecker: '',
        starBg: '',
        star: '',
        mainBg: '',
        cutAris: '',
        sponsor: '',
        Tarot: '',
        baLogo: '',
    },
    aiTranslate: {
        apiKey: '',
        systemPromptFile: '',
        createParams: {
            model: '',
            max_tokens: 1000,
            temperature: 0,
            stream: false,
            messages: [],
        },
    },
    _picPath: { font: '', avatarBg: '' },
    hotLoadConfigs: [],
    hotLoadConfigsReload: [],
    initConfig: {},
    cosUrl: '',
    retryTime: 5,
    studentNameDict: '',
    errorMessageTemaple: '',
    studentInfo: '',
    gachaPoolInfo: '',
    aliasStudentNameLocal: '',
    studentNameAlias: '',
    imagesOut: '',
    handbookRoot: '',
    extractRoot: '',
    fontRoot: '',
});
const meta = ref<SettingsMeta>({});
/** 后端解析后的全局根，用于子路径预览 */
const rootPathResolved = ref('');
const schema = ref<Record<string, unknown> | null>(null);
const activeSection = ref<SectionId>('webSettings');
const status = ref<{ type: 'ok' | 'err' | 'warn' | 'info'; text: string } | null>(null);
const loading = ref(false);
const saving = ref(false);
const dirty = ref(false);
const configReady = ref(false);
const rawJson = ref('');
const rawJsonError = ref('');
const showRaw = ref(false);
const snapshot = ref('');

const PATH_TOP_KEYS = [
    { key: 'studentNameDict', hint: '' },
    { key: 'errorMessageTemaple', hint: '历史拼写保留' },
    { key: 'studentInfo', hint: '' },
    { key: 'gachaPoolInfo', hint: '' },
    { key: 'aliasStudentNameLocal', hint: '' },
    { key: 'studentNameAlias', hint: '' },
    { key: 'imagesOut', hint: '本地出图临时目录；可填绝对路径如 /tmp/randPic' },
    { key: 'handbookRoot', hint: '' },
    { key: 'extractRoot', hint: '' },
    { key: 'fontRoot', hint: '' },
];

const IMAGE_KEYS = [
    'characters',
    'accuseCharacters',
    'firstChecker',
    'starBg',
    'star',
    'mainBg',
    'cutAris',
    'sponsor',
    'Tarot',
    'baLogo',
] as const;

const botCount = computed(() => Object.keys(config.bots || {}).length);
const sectionLabel = computed(
    () => SECTIONS.find((s) => s.id === activeSection.value)?.label || activeSection.value,
);

const initConfigText = ref('{}');
const initConfigError = ref('');

function setStatus(type: 'ok' | 'err' | 'warn' | 'info', text: string) {
    status.value = { type, text };
}

function fieldDesc(path: string, fallback = '') {
    return schemaDescription(schema.value, path) || fallback;
}

function deepClone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
}

/** 任意旧路径形态 → 子路径字符串 */
function asChildPath(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') {
        const m = /^\$\{(_path|workspace|workspaceData)\}[/\\]?(.*)$/.exec(value);
        if (m) {
            const rest = (m[2] || '').replace(/\\/g, '/');
            if (m[1] === 'workspaceData') {
                if (!rest) return 'data';
                if (rest === 'data' || rest.startsWith('data/')) return rest;
                return `data/${rest}`;
            }
            return rest;
        }
        return value;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        const o = value as { root?: string; child?: string; path?: string };
        if (typeof o.child === 'string' || o.root) {
            const child = (o.child ?? '').replace(/\\/g, '/');
            if (o.root === 'absolute') return child;
            if (o.root === 'workspaceData') {
                if (!child) return 'data';
                if (child === 'data' || child.startsWith('data/') || child.startsWith('/')) {
                    return child;
                }
                return `data/${child}`;
            }
            return child;
        }
        if (typeof o.path === 'string') return asChildPath(o.path);
    }
    return String(value);
}

/** 保证表单所需的嵌套结构存在 */
function normalizeConfig(src: AnyConfig): AnyConfig {
    const c = deepClone(src || {});

    c.webSettings = {
        enabled: true,
        token: '',
        ...(c.webSettings || {}),
    };
    if (c.webSettings.enabled === undefined) c.webSettings.enabled = true;
    if (c.webSettings.token === undefined) c.webSettings.token = '';

    c.rootPath = typeof c.rootPath === 'string' ? c.rootPath : '';
    delete c.pathRoots;
    delete c.$schema;

    c.bots = c.bots && typeof c.bots === 'object' && !Array.isArray(c.bots) ? c.bots : {};

    const redisSrc = c.redis && typeof c.redis === 'object' ? c.redis : {};
    const redisSocket =
        redisSrc.socket && typeof redisSrc.socket === 'object' ? redisSrc.socket : {};
    c.redis = {
        ...redisSrc,
        socket: {
            host: '127.0.0.1',
            port: 6379,
            ...redisSocket,
        },
        password: redisSrc.password ?? '',
        database: redisSrc.database ?? 0,
    };

    c.mariadb = {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        connectTimeout: 5000,
        connectionLimit: 100,
        ...(c.mariadb || {}),
    };

    c.mongo = {
        host: '127.0.0.1',
        port: 27017,
        connectTimeoutMS: 5000,
        serverSelectionTimeoutMS: 5000,
        ...(c.mongo || {}),
    };

    c.cos = {
        SecretId: '',
        SecretKey: '',
        Bucket: '',
        Region: '',
        ...(c.cos || {}),
    };

    c.groupPush = {
        url: '',
        authKey: '',
        appId: '',
        llobKey: '',
        ...(c.groupPush || {}),
    };

    c.onebot = {
        baseUrl: '',
        localUploadPath: '',
        remoteUploadPath: '',
        ...(c.onebot || {}),
    };

    const smsSrc = c.sms && typeof c.sms === 'object' ? c.sms : {};
    c.sms = {
        ...smsSrc,
        AccessKey: {
            AccessKeyId: '',
            AccessKeySecret: '',
            ...(smsSrc.AccessKey || {}),
        },
        sendInfo: {
            phone: 0,
            sign: '',
            template: '',
            ...(smsSrc.sendInfo || {}),
        },
    };

    c.baiduCensoring = {
        APP_ID: '',
        API_KEY: '',
        SECRET_KEY: '',
        ...(c.baiduCensoring || {}),
    };

    const imagesSrc = c.images && typeof c.images === 'object' ? c.images : {};
    c.images = {
        characters: '',
        accuseCharacters: '',
        firstChecker: '',
        starBg: '',
        star: '',
        mainBg: '',
        cutAris: '',
        sponsor: '',
        Tarot: '',
        baLogo: '',
        ...imagesSrc,
        gachaMask: Array.isArray(imagesSrc.gachaMask)
            ? imagesSrc.gachaMask.map((v: unknown) => asChildPath(v))
            : ['', '', '', ''],
    };
    for (const k of IMAGE_KEYS) {
        c.images[k] = asChildPath(c.images[k]);
    }

    const aiSrc = c.aiTranslate && typeof c.aiTranslate === 'object' ? c.aiTranslate : {};
    const createParamsSrc =
        aiSrc.createParams && typeof aiSrc.createParams === 'object' ? aiSrc.createParams : {};
    c.aiTranslate = {
        ...aiSrc,
        apiKey: aiSrc.apiKey ?? '',
        systemPromptFile: asChildPath(aiSrc.systemPromptFile),
        createParams: {
            ...createParamsSrc,
            model: createParamsSrc.model ?? '',
            max_tokens: createParamsSrc.max_tokens ?? 1000,
            temperature: createParamsSrc.temperature ?? 0,
            stream: Boolean(createParamsSrc.stream),
            messages: Array.isArray(createParamsSrc.messages)
                ? deepClone(createParamsSrc.messages)
                : [],
        },
    };

    c._picPath = {
        font: asChildPath(c._picPath?.font),
        avatarBg: asChildPath(c._picPath?.avatarBg),
    };

    if (!Array.isArray(c.hotLoadConfigs)) c.hotLoadConfigs = [];
    c.hotLoadConfigs = c.hotLoadConfigs.map((item: AnyConfig) => ({
        path: asChildPath(
            item.root != null ? { root: item.root, child: item.child ?? item.path } : item.path,
        ),
        type: item.type ?? '',
    }));

    if (!Array.isArray(c.hotLoadConfigsReload)) c.hotLoadConfigsReload = [];
    c.hotLoadConfigsReload = c.hotLoadConfigsReload.map((item: AnyConfig) => ({
        path: asChildPath(
            item.root != null ? { root: item.root, child: item.child ?? item.path } : item.path,
        ),
        name: item.name ?? '',
    }));

    if (!c.initConfig || typeof c.initConfig !== 'object' || Array.isArray(c.initConfig)) {
        c.initConfig = {};
    }
    if (typeof c.cosUrl !== 'string') c.cosUrl = '';
    if (typeof c.retryTime !== 'number') c.retryTime = 5;

    for (const { key } of PATH_TOP_KEYS) {
        c[key] = asChildPath(c[key]);
    }
    return c;
}

function applyConfig(src: AnyConfig) {
    const normalized = normalizeConfig(src);
    // 清空后回填，避免残留键
    for (const k of Object.keys(config)) delete config[k];
    Object.assign(config, normalized);
    initConfigText.value = JSON.stringify(config.initConfig ?? {}, null, 4);
    initConfigError.value = '';
    rawJson.value = JSON.stringify(config, null, 4);
    rawJsonError.value = '';
    snapshot.value = JSON.stringify(config);
    dirty.value = false;
}

function markDirty() {
    dirty.value = JSON.stringify(config) !== snapshot.value;
}

watch(config, markDirty, { deep: true });

watch(initConfigText, (text) => {
    try {
        const parsed = JSON.parse(text || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            initConfigError.value = 'initConfig 必须是 JSON 对象';
            return;
        }
        initConfigError.value = '';
        config.initConfig = parsed;
    } catch (e) {
        initConfigError.value = e instanceof Error ? e.message : 'JSON 无效';
    }
});

async function load() {
    loading.value = true;
    setStatus('info', '加载中…');
    try {
        const data = await fetchConfig();
        applyConfig(data.config as AnyConfig);
        rootPathResolved.value = data.rootPathResolved || '';
        schema.value = (data.schema as Record<string, unknown>) || null;
        meta.value = {
            configPath: data.configPath,
            botType: data.botType,
            devEnv: data.devEnv,
        };
        configReady.value = true;
        setStatus(
            'ok',
            `已加载 ${data.configPath || 'settings.json'}（说明见 settings.schema.json）`,
        );
    } catch (e) {
        setStatus('err', e instanceof Error ? e.message : '加载失败');
        throw e;
    } finally {
        loading.value = false;
    }
}

function syncRawFromForm() {
    rawJson.value = JSON.stringify(config, null, 4);
    rawJsonError.value = '';
}

function applyRawToForm() {
    try {
        const parsed = JSON.parse(rawJson.value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            rawJsonError.value = '根节点必须是对象';
            return;
        }
        if (!('bots' in (parsed as object))) {
            rawJsonError.value = '配置必须包含 bots 字段';
            return;
        }
        applyConfig(parsed as AnyConfig);
        rawJsonError.value = '';
        setStatus('ok', '已从 JSON 同步到表单');
        showRaw.value = false;
    } catch (e) {
        rawJsonError.value = e instanceof Error ? e.message : 'JSON 解析失败';
    }
}

async function save() {
    if (initConfigError.value) {
        setStatus('err', `initConfig: ${initConfigError.value}`);
        activeSection.value = 'advanced';
        return;
    }
    if (!config.bots || typeof config.bots !== 'object') {
        setStatus('err', '配置必须包含 bots 字段');
        return;
    }

    saving.value = true;
    setStatus('info', '保存中…');
    try {
        const payload = deepClone(config);
        // AI 相关字段已迁至 config/ai.json（aiTranslate 除外）；保存 settings.json 时剥离，避免两处并存
        for (const bot of Object.values(payload.bots || {})) {
            if (bot && typeof bot === 'object') {
                delete (bot as Record<string, unknown>).dsKey;
                delete (bot as Record<string, unknown>).chatbot;
            }
        }
        const data = await saveConfig(payload);
        meta.value = {
            configPath: data.configPath,
            botType: data.botType,
            devEnv: data.devEnv,
        };
        snapshot.value = JSON.stringify(config);
        dirty.value = false;
        setStatus(
            'ok',
            data.hint ||
                '已保存并热加载到当前 bot 进程。端口 / intents / 已建库连接等少数项仍需重启。',
        );
    } catch (e) {
        setStatus('err', e instanceof Error ? e.message : '保存失败');
    } finally {
        saving.value = false;
    }
}

function setBots(bots: Record<string, BotConfigModel>) {
    config.bots = bots;
}

function updateGachaMask(i: number, value: string) {
    if (!Array.isArray(config.images.gachaMask)) {
        config.images.gachaMask = ['', '', '', ''];
    }
    config.images.gachaMask[i] = value;
}

function addHotLoad() {
    config.hotLoadConfigs.push({ path: '', type: '' });
}

function removeHotLoad(i: number) {
    config.hotLoadConfigs.splice(i, 1);
}

function addHotLoadReload() {
    config.hotLoadConfigsReload.push({ path: '', name: '' });
}

function removeHotLoadReload(i: number) {
    config.hotLoadConfigsReload.splice(i, 1);
}

function updateMessage(i: number, key: 'role' | 'content', value: string) {
    if (!Array.isArray(config.aiTranslate.createParams.messages)) {
        config.aiTranslate.createParams.messages = [];
    }
    const msg = config.aiTranslate.createParams.messages[i] || { role: 'user', content: '' };
    msg[key] = value;
    config.aiTranslate.createParams.messages[i] = msg;
}

function addMessage() {
    if (!Array.isArray(config.aiTranslate.createParams.messages)) {
        config.aiTranslate.createParams.messages = [];
    }
    config.aiTranslate.createParams.messages.push({ role: 'user', content: '' });
}

function removeMessage(i: number) {
    config.aiTranslate.createParams.messages.splice(i, 1);
}

onMounted(() => {
    load().catch(() => {
        emit('logout');
    });
});
</script>

<template>
    <div class="space-y-4">
        <!-- meta -->
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div class="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-2.5">
                <div class="text-xs text-slate-500">配置文件</div>
                <div class="mt-1 break-all font-mono text-xs text-slate-200">
                    {{ meta.configPath || '—' }}
                </div>
            </div>
            <div class="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-2.5">
                <div class="text-xs text-slate-500">Bot 数量</div>
                <div class="mt-1 font-mono text-sm text-slate-200">{{ botCount }}</div>
            </div>
            <div class="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-2.5">
                <div class="text-xs text-slate-500">当前进程 botType</div>
                <div class="mt-1 font-mono text-sm text-slate-200">{{ meta.botType || '—' }}</div>
            </div>
            <div class="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-2.5">
                <div class="text-xs text-slate-500">状态</div>
                <div
                    class="mt-1 font-mono text-sm"
                    :class="dirty ? 'text-amber-300' : 'text-emerald-300'"
                >
                    {{ dirty ? '有未保存修改' : '已同步' }}
                    · {{ meta.devEnv ? 'dev' : 'prod' }}
                </div>
            </div>
        </div>

        <!-- toolbar -->
        <div class="flex flex-wrap gap-2">
            <button
                type="button"
                class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-500 hover:text-sky-300 disabled:opacity-50"
                :disabled="loading"
                @click="load"
            >
                重新加载
            </button>
            <button
                type="button"
                class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
                :disabled="saving || loading"
                @click="save"
            >
                {{ saving ? '保存中…' : '保存配置' }}
            </button>
            <button
                type="button"
                class="ml-auto rounded-lg border border-rose-500/40 px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10"
                @click="emit('logout')"
            >
                退出登录
            </button>
        </div>

        <div
            v-if="status"
            class="rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap"
            :class="{
                'border-emerald-500/40 bg-emerald-500/10 text-emerald-300': status.type === 'ok',
                'border-rose-500/40 bg-rose-500/10 text-rose-300': status.type === 'err',
                'border-amber-500/40 bg-amber-500/10 text-amber-200': status.type === 'warn',
                'border-slate-600 bg-slate-900 text-slate-400': status.type === 'info',
            }"
        >
            {{ status.text }}
        </div>

        <div
            v-if="!configReady"
            class="rounded-2xl border border-slate-700/80 bg-slate-950/40 p-8 text-center text-slate-400"
        >
            {{ loading ? '正在加载配置…' : '等待配置加载' }}
        </div>

        <div v-else class="flex flex-col gap-4 lg:flex-row">
            <!-- side nav：设置分组入口 -->
            <aside class="shrink-0 lg:w-56">
                <div class="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
                    配置分组（{{ SECTIONS.length }}）
                </div>
                <nav
                    class="custom-scroll flex max-h-[70vh] gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:pb-0"
                >
                    <button
                        v-for="sec in SECTIONS"
                        :key="sec.id"
                        type="button"
                        class="min-w-[7.5rem] shrink-0 rounded-xl border px-3 py-2.5 text-left transition lg:min-w-0 lg:w-full"
                        :class="
                            activeSection === sec.id
                                ? 'border-sky-500 bg-sky-500/15 text-sky-200 shadow-sm shadow-sky-900/30'
                                : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                        "
                        @click="activeSection = sec.id"
                    >
                        <div class="text-sm font-medium">{{ sec.label }}</div>
                        <div class="mt-0.5 hidden text-[11px] leading-snug text-slate-500 lg:block">
                            {{ sec.desc }}
                        </div>
                    </button>
                </nav>
            </aside>

            <!-- content -->
            <div
                class="custom-scroll min-h-[50vh] min-w-0 flex-1 space-y-5 rounded-2xl border border-slate-700/80 bg-slate-950/40 p-4 sm:p-5"
            >
                <div
                    class="sticky top-0 z-10 -mx-1 mb-1 flex items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-900/90 px-3 py-2 backdrop-blur"
                >
                    <div class="text-sm font-semibold text-slate-100">{{ sectionLabel }}</div>
                    <div class="font-mono text-[11px] text-slate-500">{{ activeSection }}</div>
                </div>
                <!-- webSettings -->
                <template v-if="activeSection === 'webSettings'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">Web 设置</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            {{ fieldDesc('webSettings', '控制本设置页是否可用，以及访问口令。') }}
                        </p>
                    </header>
                    <Field
                        label="enabled"
                        :hint="
                            fieldDesc('webSettings.enabled', '关闭后 /settings 与 API 将拒绝访问')
                        "
                    >
                        <BoolInput v-model="config.webSettings.enabled" label="启用 Web 设置页" />
                    </Field>
                    <Field label="token" :hint="fieldDesc('webSettings.token', '浏览器登录口令')">
                        <TextInput v-model="config.webSettings.token" type="password" />
                    </Field>
                </template>

                <!-- bots -->
                <template v-else-if="activeSection === 'bots'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">Bots</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            {{
                                fieldDesc(
                                    'bots',
                                    '按 bot 编辑身份、端口、intent、群映射（AI 配置见「AI 配置」页）。',
                                )
                            }}
                        </p>
                    </header>
                    <BotEditor :model-value="config.bots" @update:model-value="setBots" />
                </template>

                <!-- ai（独立 ai.json：dsKey / chatbot；aiTranslate 除外仍留 settings.json） -->
                <template v-else-if="activeSection === 'ai'">
                    <AIConfigEditor />
                </template>
                <template v-else-if="activeSection === 'sticker'">
                    <StickerLibrary />
                </template>

                <!-- redis -->
                <template v-else-if="activeSection === 'redis'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">Redis</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            {{ fieldDesc('redis', '业务状态、禁言、历史、按钮 eventId 等。') }}
                        </p>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="socket.host">
                            <TextInput v-model="config.redis.socket.host" mono />
                        </Field>
                        <Field label="socket.port">
                            <NumberInput v-model="config.redis.socket.port" integer />
                        </Field>
                        <Field label="password">
                            <TextInput v-model="config.redis.password" type="password" />
                        </Field>
                        <Field label="database">
                            <NumberInput v-model="config.redis.database" integer :min="0" />
                        </Field>
                    </div>
                </template>

                <!-- mariadb -->
                <template v-else-if="activeSection === 'mariadb'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">MariaDB</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            {{ fieldDesc('mariadb', '可选持久化；bot 还需 allowMariadb=true。') }}
                        </p>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="host">
                            <TextInput v-model="config.mariadb.host" mono />
                        </Field>
                        <Field label="port">
                            <NumberInput v-model="config.mariadb.port" integer />
                        </Field>
                        <Field label="user">
                            <TextInput v-model="config.mariadb.user" mono />
                        </Field>
                        <Field label="password">
                            <TextInput v-model="config.mariadb.password" type="password" />
                        </Field>
                        <Field
                            label="connectTimeout（ms）"
                            :hint="fieldDesc('mariadb.connectTimeout')"
                        >
                            <NumberInput v-model="config.mariadb.connectTimeout" integer />
                        </Field>
                        <Field label="connectionLimit">
                            <NumberInput v-model="config.mariadb.connectionLimit" integer />
                        </Field>
                    </div>
                </template>

                <!-- mongo -->
                <template v-else-if="activeSection === 'mongo'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">MongoDB</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            {{
                                fieldDesc(
                                    'mongo',
                                    '双写持久化；bot 还需 allowMongo=true 与专用账号。',
                                )
                            }}
                        </p>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="host">
                            <TextInput v-model="config.mongo.host" mono />
                        </Field>
                        <Field label="port">
                            <NumberInput v-model="config.mongo.port" integer />
                        </Field>
                        <Field
                            label="connectTimeoutMS（ms）"
                            :hint="fieldDesc('mongo.connectTimeoutMS')"
                        >
                            <NumberInput v-model="config.mongo.connectTimeoutMS" integer />
                        </Field>
                        <Field
                            label="serverSelectionTimeoutMS（ms）"
                            :hint="fieldDesc('mongo.serverSelectionTimeoutMS')"
                        >
                            <NumberInput v-model="config.mongo.serverSelectionTimeoutMS" integer />
                        </Field>
                    </div>
                </template>

                <!-- cos -->
                <template v-else-if="activeSection === 'cos'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">腾讯云 COS</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            {{
                                fieldDesc(
                                    'cos',
                                    '出图上传；公开访问域名见「路径与通用 → cosUrl」。',
                                )
                            }}
                        </p>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="SecretId">
                            <TextInput v-model="config.cos.SecretId" type="password" />
                        </Field>
                        <Field label="SecretKey">
                            <TextInput v-model="config.cos.SecretKey" type="password" />
                        </Field>
                        <Field label="Bucket">
                            <TextInput v-model="config.cos.Bucket" mono />
                        </Field>
                        <Field label="Region" :hint="fieldDesc('cos.Region', '如 ap-guangzhou')">
                            <TextInput
                                v-model="config.cos.Region"
                                mono
                                placeholder="ap-guangzhou"
                            />
                        </Field>
                    </div>
                </template>

                <!-- paths -->
                <template v-else-if="activeSection === 'paths'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">路径与通用</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            <strong class="font-medium text-slate-300">rootPath 只设一次</strong
                            >；下方字段只填 <code class="text-sky-300/90">子路径</code>。运行时
                            <code class="text-slate-400">ConfigPath.toString()</code>
                            才拼接为绝对路径。
                        </p>
                    </header>

                    <section class="space-y-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
                        <Field
                            label="rootPath（全局）"
                            :hint="
                                fieldDesc(
                                    'rootPath',
                                    '留空 = process.cwd()。所有相对子路径相对此根。',
                                )
                            "
                        >
                            <TextInput
                                v-model="config.rootPath"
                                mono
                                placeholder="空 = 当前工作目录"
                            />
                        </Field>
                        <div class="font-mono text-[11px] text-slate-500">
                            解析后 rootPath =
                            <span class="text-sky-300/90">{{ rootPathResolved || '—' }}</span>
                            <span class="text-slate-600"> （保存并热加载后刷新可见最新值） </span>
                        </div>
                    </section>

                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="cosUrl" :hint="fieldDesc('cosUrl', 'COS 公网域名前缀')">
                            <TextInput v-model="config.cosUrl" type="url" mono />
                        </Field>
                        <Field label="retryTime" :hint="fieldDesc('retryTime', '发送失败重试次数')">
                            <NumberInput v-model="config.retryTime" integer :min="0" />
                        </Field>
                    </div>

                    <div class="space-y-4">
                        <Field
                            v-for="item in PATH_TOP_KEYS"
                            :key="item.key"
                            :label="item.key"
                            :hint="fieldDesc(item.key, item.hint || '')"
                        >
                            <PathField
                                v-model="config[item.key]"
                                :root-path-resolved="rootPathResolved"
                            />
                        </Field>
                        <Field label="_picPath.font" :hint="fieldDesc('_picPath.font')">
                            <PathField
                                v-model="config._picPath.font"
                                :root-path-resolved="rootPathResolved"
                            />
                        </Field>
                        <Field label="_picPath.avatarBg" :hint="fieldDesc('_picPath.avatarBg')">
                            <PathField
                                v-model="config._picPath.avatarBg"
                                :root-path-resolved="rootPathResolved"
                            />
                        </Field>
                    </div>
                </template>

                <!-- images -->
                <template v-else-if="activeSection === 'images'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">图片资源</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            {{
                                fieldDesc(
                                    'images',
                                    '只填相对 rootPath 的子路径（如 data/images/…）。',
                                )
                            }}
                        </p>
                    </header>
                    <Field
                        label="gachaMask"
                        :hint="
                            fieldDesc('images.gachaMask', '按稀有度索引的卡背图，下标 0 通常为空')
                        "
                    >
                        <div class="space-y-3">
                            <div
                                v-for="(_, i) in config.images.gachaMask"
                                :key="i"
                                class="rounded-lg border border-slate-800 p-2"
                            >
                                <div class="mb-1 font-mono text-xs text-slate-500">[{{ i }}]</div>
                                <PathField
                                    :model-value="config.images.gachaMask[i]"
                                    :root-path-resolved="rootPathResolved"
                                    @update:model-value="updateGachaMask(i, $event)"
                                />
                            </div>
                            <button
                                type="button"
                                class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:border-sky-500 hover:text-sky-300"
                                @click="config.images.gachaMask.push('')"
                            >
                                添加一项
                            </button>
                        </div>
                    </Field>
                    <div class="space-y-4">
                        <Field v-for="key in IMAGE_KEYS" :key="key" :label="key">
                            <PathField
                                v-model="config.images[key]"
                                :root-path-resolved="rootPathResolved"
                            />
                        </Field>
                    </div>
                </template>

                <!-- aiTranslate -->
                <template v-else-if="activeSection === 'aiTranslate'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">AI 翻译</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            system prompt 文件会在启动时注入 messages 首条 system。
                        </p>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="apiKey">
                            <TextInput v-model="config.aiTranslate.apiKey" type="password" />
                        </Field>
                        <Field label="systemPromptFile" class="sm:col-span-2">
                            <PathField
                                v-model="config.aiTranslate.systemPromptFile"
                                :root-path-resolved="rootPathResolved"
                                placeholder="如 data/aiPrompt.txt"
                            />
                        </Field>
                        <Field label="createParams.model">
                            <TextInput v-model="config.aiTranslate.createParams.model" mono />
                        </Field>
                        <Field label="max_tokens">
                            <NumberInput
                                v-model="config.aiTranslate.createParams.max_tokens"
                                integer
                            />
                        </Field>
                        <Field label="temperature">
                            <NumberInput
                                v-model="config.aiTranslate.createParams.temperature"
                                :step="0.1"
                            />
                        </Field>
                        <Field label="stream">
                            <BoolInput
                                v-model="config.aiTranslate.createParams.stream"
                                label="流式输出"
                            />
                        </Field>
                    </div>
                    <div class="space-y-3">
                        <div class="flex items-center justify-between">
                            <h3 class="text-sm font-semibold text-slate-300">
                                createParams.messages
                            </h3>
                            <button
                                type="button"
                                class="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:border-sky-500 hover:text-sky-300"
                                @click="addMessage"
                            >
                                添加消息
                            </button>
                        </div>
                        <div
                            v-for="(msg, i) in config.aiTranslate.createParams.messages"
                            :key="i"
                            class="space-y-2 rounded-xl border border-slate-700/80 bg-slate-950/50 p-3"
                        >
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-xs text-slate-500">#{{ i + 1 }}</span>
                                <button
                                    type="button"
                                    class="text-xs text-rose-300 hover:underline"
                                    @click="removeMessage(i)"
                                >
                                    删除
                                </button>
                            </div>
                            <Field label="role">
                                <select
                                    :value="msg.role"
                                    class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                                    @change="
                                        updateMessage(
                                            i,
                                            'role',
                                            ($event.target as HTMLSelectElement).value,
                                        )
                                    "
                                >
                                    <option value="system">system</option>
                                    <option value="user">user</option>
                                    <option value="assistant">assistant</option>
                                </select>
                            </Field>
                            <Field label="content">
                                <TextareaInput
                                    :model-value="msg.content"
                                    :rows="3"
                                    @update:model-value="updateMessage(i, 'content', $event)"
                                />
                            </Field>
                        </div>
                    </div>
                </template>

                <!-- sms -->
                <template v-else-if="activeSection === 'sms'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">短信 SMS</h2>
                        <p class="mt-1 text-sm text-slate-500">阿里云短信 AccessKey 与模板。</p>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="AccessKeyId">
                            <TextInput v-model="config.sms.AccessKey.AccessKeyId" type="password" />
                        </Field>
                        <Field label="AccessKeySecret">
                            <TextInput
                                v-model="config.sms.AccessKey.AccessKeySecret"
                                type="password"
                            />
                        </Field>
                        <Field label="sendInfo.phone">
                            <NumberInput v-model="config.sms.sendInfo.phone" integer />
                        </Field>
                        <Field label="sendInfo.sign">
                            <TextInput v-model="config.sms.sendInfo.sign" />
                        </Field>
                        <Field label="sendInfo.template">
                            <TextInput v-model="config.sms.sendInfo.template" mono />
                        </Field>
                    </div>
                </template>

                <!-- baidu -->
                <template v-else-if="activeSection === 'baiduCensoring'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">百度内容审核</h2>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="APP_ID">
                            <TextInput v-model="config.baiduCensoring.APP_ID" mono />
                        </Field>
                        <Field label="API_KEY">
                            <TextInput v-model="config.baiduCensoring.API_KEY" type="password" />
                        </Field>
                        <Field label="SECRET_KEY">
                            <TextInput v-model="config.baiduCensoring.SECRET_KEY" type="password" />
                        </Field>
                    </div>
                </template>

                <!-- groupPush -->
                <template v-else-if="activeSection === 'groupPush'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">群推送 groupPush</h2>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Field label="url" class="sm:col-span-2">
                            <TextInput v-model="config.groupPush.url" mono />
                        </Field>
                        <Field label="authKey">
                            <TextInput v-model="config.groupPush.authKey" type="password" />
                        </Field>
                        <Field label="appId">
                            <TextInput v-model="config.groupPush.appId" mono />
                        </Field>
                        <Field label="llobKey">
                            <TextInput v-model="config.groupPush.llobKey" type="password" />
                        </Field>
                    </div>
                </template>

                <!-- onebot -->
                <template v-else-if="activeSection === 'onebot'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">OneBot / llob</h2>
                    </header>
                    <div class="grid gap-4">
                        <Field label="baseUrl">
                            <TextInput v-model="config.onebot.baseUrl" mono />
                        </Field>
                        <Field label="localUploadPath">
                            <TextInput v-model="config.onebot.localUploadPath" mono />
                        </Field>
                        <Field label="remoteUploadPath">
                            <TextInput v-model="config.onebot.remoteUploadPath" mono />
                        </Field>
                    </div>
                </template>

                <!-- hotLoad -->
                <template v-else-if="activeSection === 'hotLoad'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">热加载</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            path 只填子路径（如
                            <code class="text-sky-300/90">src/plugins/</code>），相对全局 rootPath。
                        </p>
                    </header>
                    <div class="space-y-3">
                        <div class="flex items-center justify-between">
                            <h3 class="text-sm font-semibold text-slate-300">hotLoadConfigs</h3>
                            <button
                                type="button"
                                class="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:border-sky-500 hover:text-sky-300"
                                @click="addHotLoad"
                            >
                                添加模块
                            </button>
                        </div>
                        <div
                            v-if="!config.hotLoadConfigs.length"
                            class="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500"
                        >
                            无热加载模块
                        </div>
                        <div
                            v-for="(item, i) in config.hotLoadConfigs"
                            :key="i"
                            class="space-y-2 rounded-xl border border-slate-700/80 bg-slate-950/50 p-3"
                        >
                            <div class="flex items-center justify-between">
                                <span class="text-xs text-slate-500">#{{ i + 1 }}</span>
                                <button
                                    type="button"
                                    class="text-xs text-rose-300 hover:underline"
                                    @click="removeHotLoad(i)"
                                >
                                    删除
                                </button>
                            </div>
                            <Field label="type">
                                <TextInput v-model="item.type" placeholder="描述，如 插件模块" />
                            </Field>
                            <Field label="path（子路径）">
                                <PathField
                                    v-model="item.path"
                                    :root-path-resolved="rootPathResolved"
                                    placeholder="src/plugins/"
                                />
                            </Field>
                        </div>
                    </div>
                    <div class="space-y-3">
                        <div class="flex items-center justify-between">
                            <h3 class="text-sm font-semibold text-slate-300">
                                hotLoadConfigsReload
                            </h3>
                            <button
                                type="button"
                                class="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:border-sky-500 hover:text-sky-300"
                                @click="addHotLoadReload"
                            >
                                添加 reload
                            </button>
                        </div>
                        <div
                            v-if="!config.hotLoadConfigsReload.length"
                            class="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500"
                        >
                            无 reload 模块
                        </div>
                        <div
                            v-for="(item, i) in config.hotLoadConfigsReload"
                            :key="i"
                            class="space-y-2 rounded-xl border border-slate-700/80 bg-slate-950/50 p-3"
                        >
                            <div class="flex items-center justify-between">
                                <span class="text-xs text-slate-500">#{{ i + 1 }}</span>
                                <button
                                    type="button"
                                    class="text-xs text-rose-300 hover:underline"
                                    @click="removeHotLoadReload(i)"
                                >
                                    删除
                                </button>
                            </div>
                            <Field label="name">
                                <TextInput v-model="item.name" placeholder="定时任务" />
                            </Field>
                            <Field label="path（子路径）">
                                <PathField
                                    v-model="item.path"
                                    :root-path-resolved="rootPathResolved"
                                    placeholder="src/plugins/schedule.ts"
                                />
                            </Field>
                        </div>
                    </div>
                </template>

                <!-- advanced -->
                <template v-else-if="activeSection === 'advanced'">
                    <header>
                        <h2 class="text-lg font-semibold text-slate-100">高级 / JSON · Schema</h2>
                        <p class="mt-1 text-sm text-slate-500">
                            字段说明在
                            <code class="text-sky-300/90">config/settings.schema.json</code>
                            ；配置文件通过
                            <code class="text-slate-300">"$schema": "./settings.schema.json"</code>
                            关联，IDE 可补全与校验。
                        </p>
                    </header>

                    <Field label="initConfig" :hint="fieldDesc('initConfig', '自由对象')">
                        <TextareaInput v-model="initConfigText" mono :rows="8" />
                    </Field>
                    <p v-if="initConfigError" class="text-sm text-rose-300">
                        {{ initConfigError }}
                    </p>

                    <div class="rounded-xl border border-slate-700/80 p-3 space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-sm font-semibold text-slate-300">整文件 JSON</h3>
                            <button
                                type="button"
                                class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-300"
                                @click="
                                    showRaw = !showRaw;
                                    if (showRaw) syncRawFromForm();
                                "
                            >
                                {{ showRaw ? '收起' : '展开' }}
                            </button>
                            <button
                                v-if="showRaw"
                                type="button"
                                class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-300"
                                @click="syncRawFromForm"
                            >
                                从表单刷新
                            </button>
                            <button
                                v-if="showRaw"
                                type="button"
                                class="rounded border border-amber-500/40 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/10"
                                @click="applyRawToForm"
                            >
                                应用 JSON 到表单
                            </button>
                        </div>
                        <template v-if="showRaw">
                            <TextareaInput v-model="rawJson" mono :rows="18" />
                            <p v-if="rawJsonError" class="mt-2 text-sm text-rose-300">
                                {{ rawJsonError }}
                            </p>
                        </template>
                        <p v-else class="text-xs text-slate-500">
                            备注写在 schema 的 description，不要写进
                            JSON。保存仍用顶栏「保存配置」。
                        </p>
                    </div>
                </template>
            </div>
        </div>

        <p class="text-xs leading-relaxed text-slate-500">
            路径：磁盘
            <code class="text-slate-400">rootPath</code>
            + 子路径；运行时
            <code class="text-slate-400">ConfigPath.toString()</code>
            拼接。字段备注写在
            <code class="text-slate-400">settings.schema.json</code>
            （IDE 通过
            <code class="text-slate-400">$schema</code>
            关联）。
        </p>
    </div>
</template>
