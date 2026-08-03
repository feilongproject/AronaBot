<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        modelValue: Record<string, string>[] | undefined;
        fields: { key: string; label: string; placeholder?: string }[];
        emptyText?: string;
        addLabel?: string;
    }>(),
    {
        emptyText: '暂无条目',
        addLabel: '添加一行',
    },
);

const emit = defineEmits<{
    'update:modelValue': [value: Record<string, string>[]];
}>();

function list(): Record<string, string>[] {
    return Array.isArray(props.modelValue) ? props.modelValue.map((x) => ({ ...x })) : [];
}

function commit(next: Record<string, string>[]) {
    emit('update:modelValue', next);
}

function add() {
    const row: Record<string, string> = {};
    for (const f of props.fields) row[f.key] = '';
    commit([...list(), row]);
}

function remove(i: number) {
    const next = list();
    next.splice(i, 1);
    commit(next);
}

function update(i: number, key: string, value: string) {
    const next = list();
    next[i] = { ...next[i], [key]: value };
    commit(next);
}
</script>

<template>
    <div class="space-y-3">
        <div
            v-if="list().length === 0"
            class="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-center text-xs text-slate-500"
        >
            {{ emptyText }}
        </div>
        <div
            v-for="(row, i) in list()"
            :key="i"
            class="rounded-xl border border-slate-700/80 bg-slate-950/50 p-3"
        >
            <div class="mb-2 flex items-center justify-between">
                <span class="text-xs text-slate-500">#{{ i + 1 }}</span>
                <button
                    type="button"
                    class="rounded border border-rose-500/40 px-2 py-0.5 text-xs text-rose-300 hover:bg-rose-500/10"
                    @click="remove(i)"
                >
                    删除
                </button>
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
                <div v-for="f in fields" :key="f.key" class="space-y-1">
                    <div class="text-xs text-slate-500">{{ f.label }}</div>
                    <input
                        :value="row[f.key] ?? ''"
                        :placeholder="f.placeholder"
                        spellcheck="false"
                        class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                        @input="update(i, f.key, ($event.target as HTMLInputElement).value)"
                    />
                </div>
            </div>
        </div>
        <button
            type="button"
            class="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
            @click="add"
        >
            {{ addLabel }}
        </button>
    </div>
</template>
