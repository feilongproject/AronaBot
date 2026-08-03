<script setup lang="ts">
import { ref } from 'vue';
import { auth, setToken } from '../api';

const emit = defineEmits<{
    success: [];
}>();

const token = ref('');
const loading = ref(false);
const error = ref('');

async function submit() {
    error.value = '';
    const value = token.value.trim();
    if (!value) {
        error.value = '请输入访问口令';
        return;
    }
    loading.value = true;
    try {
        setToken(value);
        await auth();
        emit('success');
    } catch (e) {
        setToken(null);
        error.value = e instanceof Error ? e.message : '登录失败';
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <div
        class="mx-auto w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-900/70 p-6 shadow-xl backdrop-blur"
    >
        <div class="mb-6">
            <h2 class="text-lg font-semibold text-slate-100">登录设置页</h2>
            <p class="mt-1 text-sm text-slate-400">
                口令来自
                <code class="rounded bg-slate-800 px-1.5 py-0.5 text-sky-300"
                    >settings.json → webSettings.token</code
                >
            </p>
        </div>

        <label class="mb-1.5 block text-sm text-slate-400" for="token">访问口令</label>
        <input
            id="token"
            v-model="token"
            type="password"
            autocomplete="current-password"
            placeholder="输入 webSettings.token"
            class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
            @keydown.enter="submit"
        />

        <button
            type="button"
            class="mt-4 w-full rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="loading"
            @click="submit"
        >
            {{ loading ? '验证中…' : '登录' }}
        </button>

        <p
            v-if="error"
            class="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
        >
            {{ error }}
        </p>

        <p class="mt-4 text-xs leading-relaxed text-slate-500">
            请勿在公网暴露 webhook 端口且使用默认 token。保存配置后会热加载到当前 bot 进程；端口 /
            intents / 数据库连接等少数项仍需重启。
        </p>
    </div>
</template>
