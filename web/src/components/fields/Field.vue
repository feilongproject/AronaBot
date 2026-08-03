<script setup lang="ts">
defineProps<{
    label: string;
    hint?: string;
    forId?: string;
}>();
</script>

<template>
    <div class="space-y-1.5">
        <label
            v-if="label"
            class="block text-sm font-medium text-slate-300"
            :for="forId"
        >
            {{ label }}
        </label>
        <slot />
        <p v-if="hint" class="text-xs leading-relaxed text-slate-500">{{ hint }}</p>
    </div>
</template>
