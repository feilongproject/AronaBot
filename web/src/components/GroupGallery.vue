<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
    fetchGalleries,
    fetchGalleryImages,
    type GalleryGroupSummary,
    type GalleryImageItem,
} from '../api';

const PAGE_SIZE = 24;

const loading = ref(false);
const err = ref('');
const groups = ref<GalleryGroupSummary[]>([]);
const total = ref(0);

const selectedGid = ref('');
const selectedGallery = ref('');

const images = ref<GalleryImageItem[]>([]);
const imgTotal = ref(0);
const page = ref(1);
const loadingImages = ref(false);
const imgErr = ref('');

/** 灯箱当前索引，-1 表示关闭 */
const previewIndex = ref(-1);
const preview = computed(() =>
    previewIndex.value >= 0 ? (images.value[previewIndex.value] ?? null) : null,
);

const currentGroup = computed(() => groups.value.find((g) => g.gid === selectedGid.value) || null);
const totalPages = computed(() => Math.max(1, Math.ceil(imgTotal.value / PAGE_SIZE)));

async function loadSummary() {
    loading.value = true;
    err.value = '';
    try {
        const res = await fetchGalleries();
        groups.value = res.groups;
        total.value = res.total;
        // 默认选中第一个群；原选中群仍存在则保持
        if (!groups.value.some((g) => g.gid === selectedGid.value)) {
            selectedGid.value = groups.value[0]?.gid || '';
            selectedGallery.value = '';
            page.value = 1;
        }
    } catch (e) {
        err.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}

async function loadImages() {
    if (!selectedGid.value) {
        images.value = [];
        imgTotal.value = 0;
        return;
    }
    loadingImages.value = true;
    imgErr.value = '';
    try {
        const res = await fetchGalleryImages({
            gid: selectedGid.value,
            gallery: selectedGallery.value || undefined,
            page: page.value,
            pageSize: PAGE_SIZE,
        });
        // 过滤变化导致当前页为空时回退第一页
        if (page.value > 1 && res.list.length === 0 && res.total > 0) {
            page.value = 1;
            return loadImages();
        }
        images.value = res.list;
        imgTotal.value = res.total;
    } catch (e) {
        imgErr.value = e instanceof Error ? e.message : String(e);
        images.value = [];
        imgTotal.value = 0;
    } finally {
        loadingImages.value = false;
    }
}

function refresh() {
    loadSummary();
    loadImages();
}

function selectGroup(gid: string) {
    if (selectedGid.value === gid) return;
    selectedGid.value = gid;
    selectedGallery.value = '';
    page.value = 1;
}

function selectGallery(name: string) {
    if (selectedGallery.value === name) return;
    selectedGallery.value = name;
    page.value = 1;
}

function openPreview(i: number) {
    previewIndex.value = i;
}
function closePreview() {
    previewIndex.value = -1;
}
function stepPreview(delta: number) {
    const n = images.value.length;
    if (!n || previewIndex.value < 0) return;
    previewIndex.value = (previewIndex.value + delta + n) % n;
}
function onPreviewKey(e: KeyboardEvent) {
    if (previewIndex.value < 0) return;
    if (e.key === 'Escape') closePreview();
    else if (e.key === 'ArrowRight') stepPreview(1);
    else if (e.key === 'ArrowLeft') stepPreview(-1);
}

function shortAid(aid: string) {
    if (!aid) return '-';
    return aid.length > 12 ? `${aid.slice(0, 8)}…` : aid;
}

function fmtTime(ts: string | null) {
    if (!ts) return '-';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

watch([selectedGid, selectedGallery, page], () => loadImages());

onMounted(() => {
    loadSummary();
    window.addEventListener('keydown', onPreviewKey);
});
onUnmounted(() => {
    window.removeEventListener('keydown', onPreviewKey);
});
</script>

<template>
    <div class="space-y-4">
        <header class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 class="text-lg font-semibold text-slate-100">群图库</h2>
                <p class="mt-1 text-sm text-slate-500">
                    群命名图库（群内「添加xxx」收录 /「来点xxx」抽取）· 共 {{ total }} 张
                </p>
            </div>
            <button
                type="button"
                class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-sky-500 hover:text-sky-300 disabled:opacity-40"
                :disabled="loading"
                @click="refresh"
            >
                {{ loading ? '加载中…' : '刷新' }}
            </button>
        </header>

        <div
            v-if="err"
            class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
        >
            {{ err }}
        </div>

        <div
            v-else-if="!loading && !groups.length"
            class="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-6 text-center text-sm text-slate-400"
        >
            暂无群图库（在白名单群内发送「添加xxx」并附图即可收录）
        </div>

        <template v-else>
            <!-- 群选择 -->
            <div class="flex flex-wrap items-center gap-2">
                <span class="w-8 shrink-0 text-xs text-slate-500">群</span>
                <button
                    v-for="g in groups"
                    :key="g.gid"
                    type="button"
                    class="rounded-lg border px-3 py-1.5 text-sm transition"
                    :class="
                        selectedGid === g.gid
                            ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                            : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                    "
                    @click="selectGroup(g.gid)"
                >
                    {{ g.gid }}
                    <span class="ml-1 text-[11px] text-slate-500">
                        {{ g.galleryCount }} 图库 / {{ g.imageCount }} 图
                    </span>
                </button>
            </div>

            <!-- 图库选择 -->
            <div v-if="currentGroup" class="flex flex-wrap items-center gap-2">
                <span class="w-8 shrink-0 text-xs text-slate-500">图库</span>
                <button
                    type="button"
                    class="rounded-lg border px-3 py-1.5 text-sm transition"
                    :class="
                        selectedGallery === ''
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                            : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                    "
                    @click="selectGallery('')"
                >
                    全部
                    <span class="ml-1 text-[11px] text-slate-500">{{
                        currentGroup.imageCount
                    }}</span>
                </button>
                <button
                    v-for="gl in currentGroup.galleries"
                    :key="gl.gallery_name"
                    type="button"
                    class="rounded-lg border px-3 py-1.5 text-sm transition"
                    :title="gl.latestTs ? `最后收录 ${fmtTime(gl.latestTs)}` : ''"
                    :class="
                        selectedGallery === gl.gallery_name
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                            : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                    "
                    @click="selectGallery(gl.gallery_name)"
                >
                    {{ gl.gallery_name }}
                    <span class="ml-1 text-[11px] text-slate-500">{{ gl.count }}</span>
                </button>
            </div>

            <!-- 图片列表 -->
            <div
                v-if="imgErr"
                class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
            >
                {{ imgErr }}
            </div>
            <div
                v-else-if="loadingImages && !images.length"
                class="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-6 text-center text-sm text-slate-400"
            >
                加载中…
            </div>
            <div
                v-else-if="!images.length"
                class="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-6 text-center text-sm text-slate-400"
            >
                该图库暂无图片
            </div>
            <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                <div
                    v-for="(img, i) in images"
                    :key="img._id"
                    class="group overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/60 transition hover:border-slate-500"
                >
                    <button type="button" class="block w-full" @click="openPreview(i)">
                        <img
                            :src="img.imageUrl"
                            :alt="img.gallery_name"
                            loading="lazy"
                            class="aspect-square w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                        />
                    </button>
                    <div class="space-y-0.5 px-2.5 py-2 text-[11px] text-slate-400">
                        <div class="flex items-center justify-between gap-1">
                            <span class="truncate font-medium text-slate-300">
                                {{ img.gallery_name }}
                            </span>
                            <span class="shrink-0 font-mono text-slate-500">#{{ img.id }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-1">
                            <span class="truncate" :title="img.aid">{{ shortAid(img.aid) }}</span>
                            <span class="shrink-0">{{ fmtTime(img.createdAt) }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- pagination -->
            <div
                v-if="imgTotal > 0"
                class="flex items-center justify-between text-sm text-slate-400"
            >
                <button
                    type="button"
                    class="rounded-lg border border-slate-700 px-3 py-1.5 transition hover:border-sky-500 hover:text-sky-300 disabled:opacity-40"
                    :disabled="page <= 1 || loadingImages"
                    @click="page--"
                >
                    上一页
                </button>
                <span class="font-mono text-xs">
                    第 {{ page }} / {{ totalPages }} 页 · 共 {{ imgTotal }} 张
                </span>
                <button
                    type="button"
                    class="rounded-lg border border-slate-700 px-3 py-1.5 transition hover:border-sky-500 hover:text-sky-300 disabled:opacity-40"
                    :disabled="page >= totalPages || loadingImages"
                    @click="page++"
                >
                    下一页
                </button>
            </div>
        </template>

        <!-- 灯箱预览 -->
        <Teleport to="body">
            <div
                v-if="preview"
                class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
                @click.self="closePreview"
            >
                <img
                    :src="preview.imageUrlRaw"
                    :alt="preview.gallery_name"
                    class="max-h-[78vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
                />
                <div
                    class="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-300"
                >
                    <span class="font-medium text-slate-100">{{ preview.gallery_name }}</span>
                    <span class="font-mono">#{{ preview.id }}</span>
                    <span :title="preview.aid">上传者 {{ shortAid(preview.aid) }}</span>
                    <span>{{ fmtTime(preview.createdAt) }}</span>
                    <a
                        :href="preview.imageUrlRaw"
                        target="_blank"
                        rel="noopener"
                        class="text-sky-400 underline-offset-2 hover:underline"
                    >
                        新标签打开原图
                    </a>
                </div>
                <div class="mt-2 flex items-center gap-3">
                    <button
                        type="button"
                        class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-400"
                        @click="stepPreview(-1)"
                    >
                        ← 上一张
                    </button>
                    <span class="font-mono text-xs text-slate-400">
                        {{ previewIndex + 1 }} / {{ images.length }}
                    </span>
                    <button
                        type="button"
                        class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-400"
                        @click="stepPreview(1)"
                    >
                        下一张 →
                    </button>
                    <button
                        type="button"
                        class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-400"
                        @click="closePreview"
                    >
                        关闭 (Esc)
                    </button>
                </div>
            </div>
        </Teleport>
    </div>
</template>
