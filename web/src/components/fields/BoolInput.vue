<script setup lang="ts">
defineProps<{
    modelValue: boolean | undefined;
    label?: string;
    id?: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: boolean];
}>();
</script>

<template>
    <label
        class="inline-flex cursor-pointer items-center gap-2.5 select-none"
        :for="id"
    >
        <button
            :id="id"
            type="button"
            role="switch"
            :aria-checked="Boolean(modelValue)"
            class="relative h-6 w-11 shrink-0 rounded-full border transition"
            :class="
                modelValue
                    ? 'border-sky-500 bg-sky-600'
                    : 'border-slate-600 bg-slate-800'
            "
            @click="emit('update:modelValue', !modelValue)"
        >
            <span
                class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition"
                :class="modelValue ? 'translate-x-5' : 'translate-x-0'"
            />
        </button>
        <span v-if="label" class="text-sm text-slate-300">{{ label }}</span>
    </label>
</template>
