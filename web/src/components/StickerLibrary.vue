<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
    deleteStickers,
    fetchStickers,
    setStickerStatus,
    updateSticker,
    type StickerItem,
} from '../api';

const STATUS_TABS = [
    { id: 'pending', label: '待审核' },
    { id: 'ready', label: '可用' },
    { id: 'hidden', label: '已隐藏' },
    { id: 'rejected', label: '已拒绝' },
    { id: '', label: '全部' },
];

const PAGE_SIZE = 24;

const loading = ref(false);
const err = ref('');
const list = ref<StickerItem[]>([]);
const total = ref(0);
const page = ref(1);
const stats = ref<Record<string, number>>({});
const q = ref('');
/** 默认打开待审核，便于人工过审 */
const status = ref('pending');
const busyId = ref('');

/** 行内编辑 */
const editingId = ref('');
const editSummary = ref('');
const editTags = ref('');

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
        // 若正在编辑的项已不在列表，关闭编辑
        if (editingId.value && !res.list.some((i) => i._id === editingId.value)) {
            cancelEdit();
        }
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
    cancelEdit();
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

function startEdit(item: StickerItem) {
    editingId.value = item._id;
    editSummary.value = item.summary || '';
    editTags.value = (item.tags || []).join(', ');
}

function cancelEdit() {
    editingId.value = '';
    editSummary.value = '';
    editTags.value = '';
}

async function saveEdit(item: StickerItem) {
    const summary = editSummary.value.trim();
    if (!summary) {
        err.value = '摘要不能为空';
        return;
    }
    busyId.value = item._id;
    try {
        const res = await updateSticker(item._id, {
            summary,
            tags: editTags.value,
        });
        item.summary = res.summary;
        item.tags = res.tags;
        cancelEdit();
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
            <span class="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">
                <input
                    v-model="q"
                    class="input min-w-0 flex-1 sm:w-48 sm:flex-none"
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
                :key="t.id || 'all'"
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

        <!-- list -->
        <div v-if="loading && !list.length" class="py-10 text-center text-sm text-slate-400">
            加载中…
        </div>
        <div v-else-if="!list.length" class="py-10 text-center text-sm text-slate-400">
            图库为空或没有匹配结果
        </div>
        <!--
          纵向卡片：图片单独在上，摘要/标签/操作在下
          手机：单列；宽屏：多列网格
        -->
        <div
            v-else
            class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
            <div
                v-for="item in list"
                :key="item._id"
                class="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/60 transition hover:border-slate-600"
                :class="{ 'opacity-50': busyId === item._id }"
            >
                <!-- 图片：独立在文字上方 -->
                <div
                    class="flex h-44 items-center justify-center overflow-hidden bg-slate-950/70 sm:h-48"
                >
                    <img
                        :src="item.imageUrl"
                        :alt="item.summary"
                        class="max-h-full max-w-full object-contain"
                        loading="lazy"
                    />
                </div>

                <!-- 文字区 -->
                <div class="space-y-2 p-2.5 sm:p-3">
                    <div
                        class="text-xs leading-snug text-slate-200 sm:text-sm"
                        :title="item.summary || '（无摘要）'"
                    >
                        {{ item.summary || '（无摘要）' }}
                    </div>

                    <!-- 状态 + 元信息（单行） -->
                    <div class="flex min-w-0 flex-wrap items-center gap-1">
                        <span
                            v-if="item.status === 'pending'"
                            class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                        >
                            待审
                        </span>
                        <span
                            v-if="item.nsfwRisk === 'high'"
                            class="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300"
                        >
                            高危
                        </span>
                        <span
                            v-else-if="item.nsfwRisk && item.nsfwRisk !== 'low'"
                            class="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-400"
                        >
                            {{ item.nsfwRisk }}
                        </span>
                        <span
                            v-if="item.isMeme"
                            class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300"
                        >
                            表情包
                        </span>
                        <span class="text-[10px] text-slate-500">
                            {{ fmtSize(item.byteSize) }}
                            <span v-if="item.width && item.height">
                                · {{ item.width }}×{{ item.height }}
                            </span>
                            · {{ fmtDate(item.ts) }}
                            <span v-if="item.useCount"> · 用{{ item.useCount }}</span>
                        </span>
                    </div>

                    <!-- 全部标签 -->
                    <div v-if="item.tags?.length" class="flex flex-wrap gap-1">
                        <span
                            v-for="t in item.tags"
                            :key="t"
                            class="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300"
                        >
                            {{ t }}
                        </span>
                    </div>
                    <div v-else class="text-[10px] text-slate-600">（无标签）</div>

                    <!-- 操作 -->
                    <div class="flex flex-wrap gap-1.5 pt-0.5">
                        <template v-if="item.status === 'pending'">
                            <button
                                type="button"
                                class="rounded border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-500/10"
                                :disabled="busyId === item._id"
                                @click="act(item, 'ready', '通过')"
                            >
                                通过
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
                        <template v-else-if="item.status === 'ready'">
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
                            class="rounded border border-sky-500/40 px-2 py-1 text-[11px] text-sky-300 transition hover:bg-sky-500/10"
                            :disabled="busyId === item._id"
                            @click="editingId === item._id ? cancelEdit() : startEdit(item)"
                        >
                            {{ editingId === item._id ? '取消' : '编辑' }}
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

                    <!-- 展开编辑区 -->
                    <div
                        v-if="editingId === item._id"
                        class="space-y-2 border-t border-slate-800 pt-2"
                    >
                        <label class="block text-[11px] text-slate-400">
                            摘要（检索主字段）
                            <input
                                v-model="editSummary"
                                class="input mt-1 w-full text-sm"
                                type="text"
                                maxlength="500"
                                placeholder="一句话描述表情内容"
                                @keyup.enter="saveEdit(item)"
                            />
                        </label>
                        <label class="block text-[11px] text-slate-400">
                            标签（逗号分隔）
                            <input
                                v-model="editTags"
                                class="input mt-1 w-full text-sm"
                                type="text"
                                placeholder="开心, 点头, OCR文字…"
                                @keyup.enter="saveEdit(item)"
                            />
                        </label>
                        <div class="flex gap-2">
                            <button
                                type="button"
                                class="rounded border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-500/10"
                                :disabled="busyId === item._id"
                                @click="saveEdit(item)"
                            >
                                保存
                            </button>
                            <button
                                type="button"
                                class="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-400"
                                @click="cancelEdit"
                            >
                                取消
                            </button>
                        </div>
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
