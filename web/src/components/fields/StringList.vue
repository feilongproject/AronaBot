<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue: string[] | undefined;
        placeholder?: string;
        emptyText?: string;
        mono?: boolean;
    }>(),
    {
        emptyText: '暂无条目',
        mono: true,
    },
);

const emit = defineEmits<{
    'update:modelValue': [value: string[]];
}>();

const draft = ref('');

function list(): string[] {
    return Array.isArray(props.modelValue) ? [...props.modelValue] : [];
}

function commit(next: string[]) {
    emit('update:modelValue', next);
}

function add() {
    const v = draft.value.trim();
    if (!v) return;
    commit([...list(), v]);
    draft.value = '';
}

function remove(i: number) {
    const next = list();
    next.splice(i, 1);
    commit(next);
}

function updateAt(i: number, value: string) {
    const next = list();
    next[i] = value;
    commit(next);
}

function move(i: number, delta: number) {
    const next = list();
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item);
    commit(next);
}
</script>

<template>
    <div class="space-y-2">
        <div
            v-if="list().length === 0"
            class="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-center text-xs text-slate-500"
        >
            {{ emptyText }}
        </div>
        <div
            v-for="(item, i) in list()"
            :key="i"
            class="flex items-center gap-2"
        >
            <input
                :value="item"
                spellcheck="false"
                class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                :class="mono ? 'font-mono' : ''"
                @input="updateAt(i, ($event.target as HTMLInputElement).value)"
            />
            <button
                type="button"
                class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                title="上移"
                @click="move(i, -1)"
            >
                ↑
            </button>
            <button
                type="button"
                class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                title="下移"
                @click="move(i, 1)"
            >
                ↓
            </button>
            <button
                type="button"
                class="rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                title="删除"
                @click="remove(i)"
            >
                删
            </button>
        </div>
        <div class="flex gap-2">
            <input
                v-model="draft"
                :placeholder="placeholder || '新增条目…'"
                spellcheck="false"
                class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                :class="mono ? 'font-mono' : ''"
                @keydown.enter.prevent="add"
            />
            <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
                @click="add"
            >
                添加
            </button>
        </div>
    </div>
</template>
