<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { auth, hasToken, setToken } from './api';
import LoginPanel from './components/LoginPanel.vue';
import EditorPanel from './components/EditorPanel.vue';

const ready = ref(false);
const loggedIn = ref(false);
const bootError = ref('');

async function tryRestoreSession() {
    if (!hasToken()) {
        loggedIn.value = false;
        ready.value = true;
        return;
    }
    try {
        await auth();
        loggedIn.value = true;
    } catch {
        setToken(null);
        loggedIn.value = false;
    } finally {
        ready.value = true;
    }
}

function onLoginSuccess() {
    loggedIn.value = true;
    bootError.value = '';
}

function onLogout() {
    setToken(null);
    loggedIn.value = false;
}

onMounted(() => {
    tryRestoreSession().catch((e) => {
        bootError.value = e instanceof Error ? e.message : String(e);
        ready.value = true;
    });
});
</script>

<template>
    <div class="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
                <h1 class="text-2xl font-semibold tracking-tight text-slate-50">
                    <span class="text-sky-400">AronaBot</span> 配置设置
                </h1>
                <p class="mt-1 text-sm text-slate-400">
                    分组表单 ·
                    <code class="text-slate-300">settings.json</code>
                    · 说明见
                    <code class="text-slate-300">settings.schema.json</code>
                    · 保存后热加载
                </p>
            </div>
        </header>

        <div v-if="!ready" class="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-8 text-center text-slate-400">
            初始化中…
        </div>

        <div
            v-else-if="bootError"
            class="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-300"
        >
            {{ bootError }}
        </div>

        <LoginPanel v-else-if="!loggedIn" @success="onLoginSuccess" />

        <div
            v-else
            class="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-4 shadow-xl backdrop-blur sm:p-6"
        >
            <EditorPanel @logout="onLogout" />
        </div>
    </div>
</template>
