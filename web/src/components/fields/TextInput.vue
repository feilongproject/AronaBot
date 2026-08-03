<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue: string | number | null | undefined;
        type?: 'text' | 'password' | 'url' | 'email';
        placeholder?: string;
        mono?: boolean;
        disabled?: boolean;
        id?: string;
    }>(),
    {
        type: 'text',
        mono: false,
        disabled: false,
    },
);

const emit = defineEmits<{
    'update:modelValue': [value: string];
}>();

const showSecret = ref(false);
const isSecret = () => props.type === 'password';

function onInput(e: Event) {
    emit('update:modelValue', (e.target as HTMLInputElement).value);
}
</script>

<template>
    <div class="relative">
        <input
            :id="id"
            :type="isSecret() && !showSecret ? 'password' : type === 'password' ? 'text' : type"
            :value="modelValue ?? ''"
            :placeholder="placeholder"
            :disabled="disabled"
            autocomplete="off"
            spellcheck="false"
            class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 disabled:opacity-50"
            :class="[
                mono || isSecret() ? 'font-mono' : '',
                isSecret() ? 'pr-16' : '',
            ]"
            @input="onInput"
        />
        <button
            v-if="isSecret()"
            type="button"
            class="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            @click="showSecret = !showSecret"
        >
            {{ showSecret ? '隐藏' : '显示' }}
        </button>
    </div>
</template>
