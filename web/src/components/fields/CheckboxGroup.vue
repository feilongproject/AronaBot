<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
    modelValue: string[] | undefined;
    options: { value: string; label?: string }[];
    allowCustom?: boolean;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string[]];
}>();

const customDraft = ref('');

function selected(): string[] {
    return Array.isArray(props.modelValue) ? props.modelValue : [];
}

function isChecked(v: string) {
    return selected().includes(v);
}

function toggle(v: string) {
    const set = new Set(selected());
    if (set.has(v)) set.delete(v);
    else set.add(v);
    // keep option order first, then extras
    const order = props.options.map((o) => o.value);
    const next = [
        ...order.filter((x) => set.has(x)),
        ...[...set].filter((x) => !order.includes(x)),
    ];
    emit('update:modelValue', next);
}

function extras(): string[] {
    const known = new Set(props.options.map((o) => o.value));
    return selected().filter((x) => !known.has(x));
}

function removeExtra(v: string) {
    emit(
        'update:modelValue',
        selected().filter((x) => x !== v),
    );
}

function submitCustom() {
    const v = customDraft.value.trim();
    if (!v || selected().includes(v)) return;
    emit('update:modelValue', [...selected(), v]);
    customDraft.value = '';
}
</script>

<template>
    <div class="space-y-2">
        <div class="flex flex-wrap gap-2">
            <button
                v-for="opt in options"
                :key="opt.value"
                type="button"
                class="rounded-full border px-2.5 py-1 font-mono text-xs transition"
                :class="
                    isChecked(opt.value)
                        ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                        : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                "
                @click="toggle(opt.value)"
            >
                {{ opt.label || opt.value }}
            </button>
        </div>
        <div v-if="extras().length" class="flex flex-wrap gap-2">
            <span
                v-for="ex in extras()"
                :key="ex"
                class="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-xs text-amber-200"
            >
                {{ ex }}
                <button type="button" class="text-amber-300/80 hover:text-white" @click="removeExtra(ex)">
                    ×
                </button>
            </span>
        </div>
        <div v-if="allowCustom" class="flex gap-2">
            <input
                v-model="customDraft"
                placeholder="自定义 intent…"
                spellcheck="false"
                class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                @keydown.enter.prevent="submitCustom"
            />
            <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
                @click="submitCustom"
            >
                添加
            </button>
        </div>
    </div>
</template>
