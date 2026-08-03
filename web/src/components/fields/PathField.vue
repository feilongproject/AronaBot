<script setup lang="ts">
import { computed } from 'vue';
import TextInput from './TextInput.vue';

/**
 * 子路径输入：全局 rootPath 只设一次，这里只填 child。
 * 预览 = join(rootPathResolved, child)；child 为绝对路径时直接显示 child。
 */
const props = withDefaults(
    defineProps<{
        modelValue: string | null | undefined;
        rootPathResolved?: string;
        placeholder?: string;
        id?: string;
    }>(),
    {
        rootPathResolved: '',
        placeholder: '相对 rootPath 的子路径，如 data/studentInfo.json',
    },
);

const emit = defineEmits<{
    'update:modelValue': [value: string];
}>();

const child = computed(() => props.modelValue ?? '');

const preview = computed(() => {
    const c = child.value.replace(/\\/g, '/');
    if (!c) return props.rootPathResolved || '（空）';
    if (c.startsWith('/')) return c;
    const root = (props.rootPathResolved || '«rootPath»').replace(/\/+$/, '');
    return `${root}/${c.replace(/^\/+/, '')}`;
});
</script>

<template>
    <div class="space-y-1.5">
        <TextInput
            :id="id"
            :model-value="child"
            mono
            :placeholder="placeholder"
            @update:model-value="emit('update:modelValue', $event)"
        />
        <div
            class="rounded-md border border-slate-800 bg-slate-950/80 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-slate-400"
        >
            <span class="text-slate-600">toString() · </span>
            <span class="text-sky-300/90">{{ preview }}</span>
        </div>
    </div>
</template>
