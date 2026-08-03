<script setup lang="ts">
withDefaults(
    defineProps<{
        modelValue: string | null | undefined;
        placeholder?: string;
        rows?: number;
        mono?: boolean;
        id?: string;
    }>(),
    {
        rows: 4,
        mono: false,
    },
);

const emit = defineEmits<{
    'update:modelValue': [value: string];
}>();

function onInput(e: Event) {
    emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
}
</script>

<template>
    <textarea
        :id="id"
        :value="modelValue ?? ''"
        :placeholder="placeholder"
        :rows="rows"
        spellcheck="false"
        class="custom-scroll w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
        :class="mono ? 'font-mono text-[12.5px] leading-relaxed' : ''"
        @input="onInput"
    />
</template>
