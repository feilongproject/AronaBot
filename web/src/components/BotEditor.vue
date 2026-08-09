<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Field from './fields/Field.vue';
import TextInput from './fields/TextInput.vue';
import NumberInput from './fields/NumberInput.vue';
import BoolInput from './fields/BoolInput.vue';
import StringList from './fields/StringList.vue';
import KeyValueMap from './fields/KeyValueMap.vue';
import CheckboxGroup from './fields/CheckboxGroup.vue';

export type EventTransportMode = 'webhook' | 'websocket';

export type BotConfigModel = {
    appID?: string;
    botUid?: string;
    token?: string;
    secret?: string;
    intents?: string[];
    /** webhook=双通道；websocket=仅 WS，HTTP 仍提供设置页 */
    eventTransport?: EventTransportMode;
    allowMarkdown?: boolean;
    allowMariadb?: boolean;
    allowMongo?: boolean;
    mongo?: {
        user?: string;
        password?: string;
        database?: string;
        authSource?: string;
    };
    webhookPort?: { prod?: number; dev?: number };
    groupMap?: Record<string, string>;
    meRealId?: string;
    enableFullReceiveGroups?: string[];
    [key: string]: unknown;
};

const props = defineProps<{
    modelValue: Record<string, BotConfigModel> | undefined;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: Record<string, BotConfigModel>];
}>();

const INTENT_OPTIONS = [
    { value: 'GUILD_MESSAGES' },
    { value: 'PUBLIC_GUILD_MESSAGES' },
    { value: 'DIRECT_MESSAGE' },
    { value: 'GUILDS' },
    { value: 'FORUMS_EVENT' },
    { value: 'GUILD_MEMBERS' },
    { value: 'GUILD_MESSAGE_REACTIONS' },
    { value: 'MESSAGE_AUDIT' },
    { value: 'GROUP_AND_C2C_EVENT' },
    { value: 'INTERACTION' },
];

const botNames = computed(() => Object.keys(props.modelValue || {}));
const activeBot = ref('');
const newBotName = ref('');
const renameDraft = ref('');

watch(
    botNames,
    (names) => {
        if (!names.length) {
            activeBot.value = '';
            renameDraft.value = '';
            return;
        }
        if (!names.includes(activeBot.value)) activeBot.value = names[0];
        renameDraft.value = activeBot.value;
    },
    { immediate: true },
);

watch(activeBot, (name) => {
    renameDraft.value = name;
});

const current = computed(() => {
    const bots = props.modelValue || {};
    return activeBot.value ? bots[activeBot.value] : undefined;
});

function ensureShape(bot: BotConfigModel): BotConfigModel {
    if (bot.eventTransport !== 'webhook') bot.eventTransport = 'websocket';
    if (!bot.webhookPort || typeof bot.webhookPort !== 'object') {
        bot.webhookPort = { prod: 0, dev: 0 };
    }
    if (!bot.groupMap || typeof bot.groupMap !== 'object') bot.groupMap = {};
    if (!Array.isArray(bot.intents)) bot.intents = [];
    if (!Array.isArray(bot.enableFullReceiveGroups)) bot.enableFullReceiveGroups = [];
    return bot;
}

function patchBots(mutator: (bots: Record<string, BotConfigModel>) => void) {
    const next = JSON.parse(JSON.stringify(props.modelValue || {})) as Record<
        string,
        BotConfigModel
    >;
    mutator(next);
    emit('update:modelValue', next);
}

function patchCurrent(mutator: (bot: BotConfigModel) => void) {
    if (!activeBot.value) return;
    patchBots((bots) => {
        const bot = ensureShape(bots[activeBot.value] || {});
        mutator(bot);
        bots[activeBot.value] = bot;
    });
}

function addBot() {
    const name = newBotName.value.trim();
    if (!name) return;
    if ((props.modelValue || {})[name]) {
        activeBot.value = name;
        newBotName.value = '';
        return;
    }
    patchBots((bots) => {
        bots[name] = ensureShape({
            appID: '',
            botUid: '',
            token: '',
            secret: '',
            intents: ['GUILD_MESSAGES'],
            eventTransport: 'websocket',
            allowMarkdown: false,
            allowMariadb: false,
            allowMongo: false,
            webhookPort: { prod: 0, dev: 0 },
            groupMap: {},
            meRealId: '',
            enableFullReceiveGroups: [],
        });
    });
    activeBot.value = name;
    newBotName.value = '';
}

function removeBot(name: string) {
    if (!confirm(`确定删除 bot「${name}」？`)) return;
    patchBots((bots) => {
        delete bots[name];
    });
}

function renameBot(oldName: string, newName: string) {
    const n = newName.trim();
    if (!n || n === oldName) return;
    if ((props.modelValue || {})[n]) {
        alert(`已存在同名 bot: ${n}`);
        return;
    }
    patchBots((bots) => {
        bots[n] = bots[oldName];
        delete bots[oldName];
    });
    activeBot.value = n;
}
</script>

<template>
    <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
            <button
                v-for="name in botNames"
                :key="name"
                type="button"
                class="rounded-full border px-3 py-1 text-sm transition"
                :class="
                    activeBot === name
                        ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                        : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                "
                @click="activeBot = name"
            >
                {{ name }}
            </button>
            <div class="flex min-w-[200px] flex-1 gap-2">
                <input
                    v-model="newBotName"
                    placeholder="新 bot 名称"
                    class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none focus:border-sky-500"
                    @keydown.enter.prevent="addBot"
                />
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 hover:border-sky-500 hover:text-sky-300"
                    @click="addBot"
                >
                    新增 Bot
                </button>
            </div>
        </div>

        <div
            v-if="!current"
            class="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500"
        >
            暂无 bot，请添加
        </div>

        <template v-else>
            <div
                class="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-700/80 bg-slate-950/40 p-3"
            >
                <Field label="Bot 名称（JSON 键）" hint="输入新名称后点「重命名」">
                    <div class="flex flex-wrap gap-2">
                        <div class="min-w-[12rem] flex-1">
                            <TextInput v-model="renameDraft" mono />
                        </div>
                        <button
                            type="button"
                            class="shrink-0 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:border-sky-500 hover:text-sky-300"
                            :disabled="!renameDraft.trim() || renameDraft.trim() === activeBot"
                            @click="renameBot(activeBot, renameDraft)"
                        >
                            重命名
                        </button>
                        <button
                            type="button"
                            class="shrink-0 rounded-lg border border-rose-500/40 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
                            @click="removeBot(activeBot)"
                        >
                            删除此 Bot
                        </button>
                    </div>
                </Field>
            </div>

            <section class="space-y-4">
                <h3 class="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                    身份与密钥
                </h3>
                <div class="grid gap-4 sm:grid-cols-2">
                    <Field label="appID">
                        <TextInput
                            :model-value="current.appID || ''"
                            mono
                            @update:model-value="patchCurrent((b) => (b.appID = $event))"
                        />
                    </Field>
                    <Field label="botUid" hint="部分场景下的机器人 openid / uid">
                        <TextInput
                            :model-value="current.botUid || ''"
                            mono
                            @update:model-value="patchCurrent((b) => (b.botUid = $event))"
                        />
                    </Field>
                    <Field label="token">
                        <TextInput
                            type="password"
                            :model-value="current.token || ''"
                            @update:model-value="patchCurrent((b) => (b.token = $event))"
                        />
                    </Field>
                    <Field label="secret" hint="Webhook 签名等">
                        <TextInput
                            type="password"
                            :model-value="current.secret || ''"
                            @update:model-value="patchCurrent((b) => (b.secret = $event))"
                        />
                    </Field>
                    <Field label="meRealId" hint="真实 QQ 号等">
                        <TextInput
                            :model-value="current.meRealId || ''"
                            mono
                            @update:model-value="patchCurrent((b) => (b.meRealId = $event))"
                        />
                    </Field>
                </div>
            </section>

            <section class="space-y-4">
                <h3 class="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                    能力开关
                </h3>
                <div class="grid gap-4 sm:grid-cols-2">
                    <Field label="allowMarkdown">
                        <BoolInput
                            :model-value="Boolean(current.allowMarkdown)"
                            label="允许 Markdown / 键盘消息"
                            @update:model-value="patchCurrent((b) => (b.allowMarkdown = $event))"
                        />
                    </Field>
                    <Field label="allowMariadb">
                        <BoolInput
                            :model-value="Boolean(current.allowMariadb)"
                            label="允许连接 MariaDB"
                            @update:model-value="patchCurrent((b) => (b.allowMariadb = $event))"
                        />
                    </Field>
                    <Field label="allowMongo">
                        <BoolInput
                            :model-value="Boolean(current.allowMongo)"
                            label="允许连接 MongoDB（双写）"
                            @update:model-value="patchCurrent((b) => (b.allowMongo = $event))"
                        />
                    </Field>
                </div>
            </section>

            <section v-if="current.allowMongo" class="space-y-4">
                <h3 class="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                    MongoDB 账号
                </h3>
                <div class="grid gap-4 sm:grid-cols-2">
                    <Field label="mongo.user">
                        <TextInput
                            :model-value="current.mongo?.user || ''"
                            mono
                            @update:model-value="
                                patchCurrent((b) => {
                                    b.mongo = { ...(b.mongo || {}), user: $event };
                                })
                            "
                        />
                    </Field>
                    <Field label="mongo.password">
                        <TextInput
                            type="password"
                            :model-value="current.mongo?.password || ''"
                            @update:model-value="
                                patchCurrent((b) => {
                                    b.mongo = { ...(b.mongo || {}), password: $event };
                                })
                            "
                        />
                    </Field>
                    <Field label="mongo.database">
                        <TextInput
                            :model-value="current.mongo?.database || ''"
                            mono
                            @update:model-value="
                                patchCurrent((b) => {
                                    b.mongo = { ...(b.mongo || {}), database: $event };
                                })
                            "
                        />
                    </Field>
                    <Field label="mongo.authSource">
                        <TextInput
                            :model-value="current.mongo?.authSource || ''"
                            mono
                            @update:model-value="
                                patchCurrent((b) => {
                                    b.mongo = { ...(b.mongo || {}), authSource: $event };
                                })
                            "
                        />
                    </Field>
                </div>
            </section>

            <section class="space-y-4">
                <h3 class="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                    事件传输
                </h3>
                <div class="grid gap-4 sm:grid-cols-2">
                    <Field
                        label="eventTransport"
                        hint="默认 websocket=仅 WebSocket；webhook=Webhook+WebSocket 双通道（HTTP 仍提供设置页）。修改后需重启"
                    >
                        <select
                            class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-sky-500"
                            :value="current.eventTransport === 'webhook' ? 'webhook' : 'websocket'"
                            @change="
                                patchCurrent(
                                    (b) =>
                                        (b.eventTransport =
                                            ($event.target as HTMLSelectElement).value === 'webhook'
                                                ? 'webhook'
                                                : 'websocket'),
                                )
                            "
                        >
                            <option value="websocket">websocket（仅 WS，默认）</option>
                            <option value="webhook">webhook（双通道）</option>
                        </select>
                    </Field>
                </div>
            </section>

            <section class="space-y-4">
                <h3 class="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                    HTTP 端口（webhookPort）
                </h3>
                <p class="text-xs text-slate-500">
                    Webhook 入口、设置页、/ping 共用；websocket 模式下也需配置以便前端可用
                </p>
                <div class="grid gap-4 sm:grid-cols-2">
                    <Field label="prod" hint="生产启动监听端口">
                        <NumberInput
                            integer
                            :model-value="current.webhookPort?.prod ?? 0"
                            @update:model-value="
                                patchCurrent((b) => {
                                    b.webhookPort = { ...(b.webhookPort || {}), prod: $event };
                                })
                            "
                        />
                    </Field>
                    <Field label="dev" hint="--dev 时监听端口">
                        <NumberInput
                            integer
                            :model-value="current.webhookPort?.dev ?? 0"
                            @update:model-value="
                                patchCurrent((b) => {
                                    b.webhookPort = { ...(b.webhookPort || {}), dev: $event };
                                })
                            "
                        />
                    </Field>
                </div>
            </section>

            <section class="space-y-3">
                <h3 class="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                    intents
                </h3>
                <CheckboxGroup
                    :model-value="current.intents || []"
                    :options="INTENT_OPTIONS"
                    allow-custom
                    @update:model-value="patchCurrent((b) => (b.intents = $event))"
                />
            </section>

            <section class="space-y-3">
                <h3 class="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                    groupMap
                </h3>
                <p class="text-xs text-slate-500">群 openid → 数字群号 映射</p>
                <KeyValueMap
                    :model-value="current.groupMap || {}"
                    key-placeholder="group openid"
                    value-placeholder="群号"
                    @update:model-value="patchCurrent((b) => (b.groupMap = $event))"
                />
            </section>

            <section class="space-y-3">
                <h3 class="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                    enableFullReceiveGroups
                </h3>
                <StringList
                    :model-value="current.enableFullReceiveGroups || []"
                    placeholder="群号"
                    empty-text="未配置全量接收群"
                    @update:model-value="patchCurrent((b) => (b.enableFullReceiveGroups = $event))"
                />
            </section>
        </template>
    </div>
</template>
