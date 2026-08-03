<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue: Record<string, string> | undefined;
        keyPlaceholder?: string;
        valuePlaceholder?: string;
        emptyText?: string;
    }>(),
    {
        keyPlaceholder: '键',
        valuePlaceholder: '值',
        emptyText: '暂无映射',
    },
);

const emit = defineEmits<{
    'update:modelValue': [value: Record<string, string>];
}>();

const draftKey = ref('');
const draftValue = ref('');

const entries = computed(() => {
    const map = props.modelValue && typeof props.modelValue === 'object' ? props.modelValue : {};
    return Object.entries(map);
});

function commit(next: Record<string, string>) {
    emit('update:modelValue', next);
}

function updateKey(oldKey: string, newKey: string) {
    if (oldKey === newKey) return;
    const map = { ...(props.modelValue || {}) };
    const val = map[oldKey];
    delete map[oldKey];
    map[newKey] = val;
    commit(map);
}

function updateValue(key: string, value: string) {
    commit({ ...(props.modelValue || {}), [key]: value });
}

function remove(key: string) {
    const map = { ...(props.modelValue || {}) };
    delete map[key];
    commit(map);
}

function add() {
    const k = draftKey.value.trim();
    if (!k) return;
    const map = { ...(props.modelValue || {}) };
    if (k in map) return;
    map[k] = draftValue.value;
    commit(map);
    draftKey.value = '';
    draftValue.value = '';
}
</script>

<template>
    <div class="space-y-2">
        <div
            v-if="entries.length === 0"
            class="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-center text-xs text-slate-500"
        >
            {{ emptyText }}
        </div>
        <div
            v-for="[k, v] in entries"
            :key="k"
            class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
        >
            <input
                :value="k"
                :placeholder="keyPlaceholder"
                spellcheck="false"
                class="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                @change="updateKey(k, ($event.target as HTMLInputElement).value.trim() || k)"
            />
            <input
                :value="v"
                :placeholder="valuePlaceholder"
                spellcheck="false"
                class="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                @input="updateValue(k, ($event.target as HTMLInputElement).value)"
            />
            <button
                type="button"
                class="rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                @click="remove(k)"
            >
                删
            </button>
        </div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
                v-model="draftKey"
                :placeholder="keyPlaceholder"
                spellcheck="false"
                class="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                @keydown.enter.prevent="add"
            />
            <input
                v-model="draftValue"
                :placeholder="valuePlaceholder"
                spellcheck="false"
                class="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                @keydown.enter.prevent="add"
            />
            <button
                type="button"
                class="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
                @click="add"
            >
                添加
            </button>
        </div>
    </div>
</template>
