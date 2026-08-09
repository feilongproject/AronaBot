<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { deleteStickers, fetchStickers, setStickerStatus, type StickerItem } from '../api';

const STATUS_TABS = [
    { id: '', label: '全部' },
    { id: 'ready', label: '可用' },
    { id: 'hidden', label: '已隐藏' },
    { id: 'rejected', label: '已拒绝' },
];

const PAGE_SIZE = 24;

const loading = ref(false);
const err = ref('');
const list = ref<StickerItem[]>([]);
const total = ref(0);
const page = ref(1);
const stats = ref<Record<string, number>>({});
const q = ref('');
const status = ref('');
const busyId = ref('');

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const statText = computed(() =>
    STATUS_TABS.filter((t) => t.id)
        .map((t) => `${t.label} ${stats.value[t.id] ?? 0}`)
        .join(' · '),
);

async function load() {
    loading.value = true;
    err.value = '';
    try {
        const res = await fetchStickers({
            q: q.value,
            status: status.value,
            page: page.value,
            pageSize: PAGE_SIZE,
        });
        list.value = res.list;
        total.value = res.total;
        stats.value = res.stats;
    } catch (e) {
        err.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}

function search() {
    page.value = 1;
    load();
}

function switchStatus(s: string) {
    if (status.value === s) return;
    status.value = s;
    page.value = 1;
    load();
}

async function act(item: StickerItem, next: string, label: string) {
    if (!confirm(`确认将这条表情「${item.summary || item._id.slice(0, 8)}」${label}？`)) return;
    busyId.value = item._id;
    try {
        await setStickerStatus(item._id, next);
        await load();
    } catch (e) {
        err.value = e instanceof Error ? e.message : String(e);
    } finally {
        busyId.value = '';
    }
}

async function remove(item: StickerItem) {
    if (!confirm(`确认删除这条表情？将从 COS 与图库同时移除，不可恢复。\n${item.summary || ''}`))
        return;
    busyId.value = item._id;
    try {
        const res = await deleteStickers([item._id]);
        if (res.failed.length) err.value = `部分删除失败: ${res.failed.join(', ')}`;
        await load();
    } catch (e) {
        err.value = e instanceof Error ? e.message : String(e);
    } finally {
        busyId.value = '';
    }
}

function fmtSize(n?: number): string {
    if (!n) return '';
    return n >= 1048576
        ? `${(n / 1048576).toFixed(1)}MB`
        : `${Math.max(1, Math.round(n / 1024))}KB`;
}

function fmtDate(ts: string | null): string {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

onMounted(load);
</script>

<template>
    <div class="space-y-4">
        <div
            v-if="err"
            class="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm whitespace-pre-wrap text-rose-300"
        >
            {{ err }}
        </div>

        <!-- stats + toolbar -->
        <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-xs text-slate-400">{{ statText || '加载中…' }}</span>
            <span class="ml-auto flex gap-2">
                <input
                    v-model="q"
                    class="input w-48"
                    type="text"
                    placeholder="搜索摘要 / 标签 / key"
                    @keyup.enter="search"
                />
                <button
                    type="button"
                    class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
                    :disabled="loading"
                    @click="search"
                >
                    {{ loading ? '搜索中…' : '搜索' }}
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
                    @click="load"
                >
                    刷新
                </button>
            </span>
        </div>

        <!-- status tabs -->
        <div class="flex flex-wrap gap-2">
            <button
                v-for="t in STATUS_TABS"
                :key="t.id"
                type="button"
                class="rounded-full border px-3 py-1 text-xs transition"
                :class="
                    status === t.id
                        ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                        : 'border-slate-700 bg-slate-900/80 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                "
                @click="switchStatus(t.id)"
            >
                {{ t.label
                }}<span v-if="t.id" class="ml-1 text-slate-500">{{ stats[t.id] ?? 0 }}</span>
            </button>
        </div>

        <!-- grid -->
        <div v-if="loading && !list.length" class="py-10 text-center text-sm text-slate-400">
            加载中…
        </div>
        <div v-else-if="!list.length" class="py-10 text-center text-sm text-slate-400">
            图库为空或没有匹配结果
        </div>
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <div
                v-for="item in list"
                :key="item._id"
                class="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/60"
                :class="{ 'opacity-50': busyId === item._id }"
            >
                <div class="flex h-40 items-center justify-center overflow-hidden bg-slate-950/60">
                    <img
                        :src="item.imageUrl"
                        :alt="item.summary"
                        class="max-h-full max-w-full object-contain"
                        loading="lazy"
                    />
                </div>
                <div class="space-y-1.5 p-2.5">
                    <div class="line-clamp-2 text-xs leading-snug text-slate-200">
                        {{ item.summary || '（无摘要）' }}
                    </div>
                    <div class="flex flex-wrap gap-1">
                        <span
                            v-for="t in item.tags.slice(0, 4)"
                            :key="t"
                            class="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300"
                        >
                            {{ t }}
                        </span>
                        <span
                            class="rounded px-1.5 py-0.5 text-[10px]"
                            :class="
                                item.nsfwRisk === 'high'
                                    ? 'bg-rose-500/15 text-rose-300'
                                    : 'bg-slate-700/60 text-slate-400'
                            "
                        >
                            {{ item.nsfwRisk === 'high' ? '高危' : item.nsfwRisk }}
                        </span>
                        <span
                            v-if="item.isMeme"
                            class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300"
                        >
                            表情包
                        </span>
                    </div>
                    <div class="text-[11px] text-slate-500">
                        使用 {{ item.useCount }} 次 · {{ fmtSize(item.byteSize) }} ·
                        {{ fmtDate(item.ts) }}
                        <span v-if="item.width && item.height">
                            · {{ item.width }}×{{ item.height }}
                        </span>
                    </div>
                    <div class="flex flex-wrap gap-1.5 pt-0.5">
                        <template v-if="item.status === 'ready'">
                            <button
                                type="button"
                                class="rounded border border-amber-500/40 px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-500/10"
                                :disabled="busyId === item._id"
                                @click="act(item, 'hidden', '隐藏')"
                            >
                                隐藏
                            </button>
                            <button
                                type="button"
                                class="rounded border border-rose-500/40 px-2 py-1 text-[11px] text-rose-300 transition hover:bg-rose-500/10"
                                :disabled="busyId === item._id"
                                @click="act(item, 'rejected', '拒绝')"
                            >
                                拒绝
                            </button>
                        </template>
                        <button
                            v-else
                            type="button"
                            class="rounded border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-500/10"
                            :disabled="busyId === item._id"
                            @click="act(item, 'ready', '恢复')"
                        >
                            恢复
                        </button>
                        <button
                            type="button"
                            class="ml-auto rounded border border-rose-500/40 px-2 py-1 text-[11px] text-rose-300 transition hover:bg-rose-500/10"
                            :disabled="busyId === item._id"
                            @click="remove(item)"
                        >
                            删除
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- pagination -->
        <div v-if="total > 0" class="flex items-center justify-between text-sm text-slate-400">
            <button
                type="button"
                class="rounded-lg border border-slate-700 px-3 py-1.5 transition hover:border-sky-500 hover:text-sky-300 disabled:opacity-40"
                :disabled="page <= 1 || loading"
                @click="
                    page--;
                    load();
                "
            >
                上一页
            </button>
            <span class="font-mono text-xs">
                第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条
            </span>
            <button
                type="button"
                class="rounded-lg border border-slate-700 px-3 py-1.5 transition hover:border-sky-500 hover:text-sky-300 disabled:opacity-40"
                :disabled="page >= totalPages || loading"
                @click="
                    page++;
                    load();
                "
            >
                下一页
            </button>
        </div>
    </div>
</template>
