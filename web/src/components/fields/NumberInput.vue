<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        modelValue: number | null | undefined;
        min?: number;
        max?: number;
        step?: number | 'any';
        placeholder?: string;
        id?: string;
        integer?: boolean;
    }>(),
    {
        step: 'any',
        integer: false,
    },
);

const emit = defineEmits<{
    'update:modelValue': [value: number];
}>();

function onInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    if (raw === '' || raw === '-') {
        emit('update:modelValue', props.integer ? 0 : 0);
        return;
    }
    const n = props.integer ? parseInt(raw, 10) : parseFloat(raw);
    if (Number.isFinite(n)) emit('update:modelValue', n);
}
</script>

<template>
    <input
        :id="id"
        type="number"
        :value="modelValue ?? ''"
        :min="min"
        :max="max"
        :step="step"
        :placeholder="placeholder"
        spellcheck="false"
        class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
        @input="onInput"
    />
</template>
