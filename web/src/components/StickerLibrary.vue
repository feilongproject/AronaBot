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
const editByKind = ref<Record<TagKind, string>>({
    emotion: '',
    style: '',
    scene: '',
    content: '',
    subject: '',
    other: '',
});

/**
 * 标签类型配色：暖色 / 冷色 / 中性 错开，避免紫蓝相近。
 * 情感玫红 · 形式琥珀 · 场景翠绿 · 内容青 · 主体靛蓝 · 其它灰
 */
type TagKind = 'emotion' | 'style' | 'scene' | 'content' | 'subject' | 'other';

const TAG_KIND_ORDER: TagKind[] = ['emotion', 'style', 'scene', 'content', 'subject', 'other'];

const TAG_KIND_META: Record<TagKind, { label: string; hint: string; chip: string; input: string }> =
    {
        emotion: {
            label: '情感',
            hint: '选图用',
            chip: 'border border-rose-400/50 bg-rose-500/20 text-rose-100',
            input: 'text-rose-200/90',
        },
        style: {
            label: '形式',
            hint: 'Q版/表情包',
            chip: 'border border-amber-400/55 bg-amber-500/20 text-amber-100',
            input: 'text-amber-200/90',
        },
        scene: {
            label: '场景',
            hint: '背景/环境',
            chip: 'border border-emerald-400/50 bg-emerald-500/20 text-emerald-100',
            input: 'text-emerald-200/90',
        },
        content: {
            label: '内容',
            hint: '动作/文案',
            chip: 'border border-cyan-400/50 bg-cyan-500/20 text-cyan-100',
            input: 'text-cyan-200/90',
        },
        subject: {
            label: '主体',
            hint: '角色/外貌',
            chip: 'border border-indigo-400/50 bg-indigo-500/20 text-indigo-100',
            input: 'text-indigo-200/90',
        },
        other: {
            label: '其它',
            hint: '未归类',
            chip: 'border border-slate-500/50 bg-slate-600/30 text-slate-200',
            input: 'text-slate-300/90',
        },
    };

type DisplayTag = { text: string; kind: TagKind };

function normKey(t: string): string {
    return t.trim().toLowerCase();
}

/** 形式/场景/内容启发式（旧数据缺字段时前端兜底上色） */
const STYLE_HINTS = new Set(
    'q版,表情包,表情,动图,静图,梗图,贴纸,二次元,卡通,插画,三视图,3d,手绘,简笔画,像素,动画截图,实拍,漫画,低画质'.split(
        ',',
    ),
);
const SCENE_HINTS = new Set(
    '雪地,床边,床上,长椅,绿幕,室内,室外,教室,海边,沙滩,街道,厨房,办公室,公园,草地,夜空,星空,天台,阳台,窗边,桌前,餐桌,沙发,舞台,直播间,白底,黑底,背景'.split(
        ',',
    ),
);
const CONTENT_HINTS = new Set(
    '探头,捂脸,抱着,拥抱,张嘴,闭眼,举手,摊手,指着,比心,挥手,鞠躬,趴着,蹲下,低头,仰头,扶额,翻白眼,吐舌头,流泪,流汗,泪眼,瞪眼,数钱,吃饭,睡觉,走路,奔跑,配文,字幕,文字,说话,喊话,举牌,摸头,托腮,抱胸,起床'.split(
        ',',
    ),
);
const EMOTION_HINTS = new Set(
    '委屈,撒娇,可怜,开心,高兴,生气,愤怒,无语,尴尬,害羞,宠溺,得意,震惊,惊讶,哭泣,悲伤,害怕,傲娇,温柔,心动,嫌弃,无奈,郁闷,难过,卖萌,呆萌,呆滞,崩溃,绝望,躺平,摆烂,佛系,淡定,吃瓜,羡慕,嫉妒,高冷,冷漠,期待,兴奋,激动,感动,滑稽,搞怪,嚣张,急切,慌张,着急,困惑,疑惑,无辜,乖巧,自信,平静,超脱,依赖,失落,失望,恶心,认怂,暴躁,狂喜,泪目,破防'.split(
        ',',
    ),
);

function guessKind(text: string): TagKind {
    const key = normKey(text);
    if (STYLE_HINTS.has(key) || STYLE_HINTS.has(key.replace(/\s/g, ''))) return 'style';
    if (EMOTION_HINTS.has(key)) return 'emotion';
    if (SCENE_HINTS.has(key)) return 'scene';
    if (CONTENT_HINTS.has(key) || text.length >= 5 || /^ocr[:：]/i.test(text)) return 'content';
    return 'subject';
}

/** 按多分类拆分展示；缺后端字段时对剩余 tags 做启发式 */
function displayTags(item: StickerItem): DisplayTag[] {
    const out: DisplayTag[] = [];
    const seen = new Set<string>();
    const push = (raw: string, kind: TagKind) => {
        const text = String(raw || '').trim();
        if (!text) return;
        const key = normKey(text);
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ text, kind });
    };

    const buckets: [TagKind, string[] | undefined][] = [
        ['emotion', item.emotionTags],
        ['style', item.styleTags],
        ['scene', item.sceneTags],
        ['content', item.contentTags],
        ['subject', item.subjectTags],
    ];
    for (const [kind, list] of buckets) {
        for (const t of list || []) push(t, kind);
    }

    const hasExtended =
        (item.sceneTags && item.sceneTags.length) ||
        (item.contentTags && item.contentTags.length) ||
        (item.subjectTags && item.subjectTags.length);

    for (const t of item.tags || []) {
        const key = normKey(t);
        if (seen.has(key)) continue;
        // 有扩展字段时剩余归 other；否则启发式猜类型
        push(t, hasExtended ? 'other' : guessKind(t));
    }
    return out;
}

function tagChipClass(kind: TagKind): string {
    return TAG_KIND_META[kind].chip;
}

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
        let res = await fetchStickers({
            q: q.value,
            status: status.value,
            page: page.value,
            pageSize: PAGE_SIZE,
        });
        // 本页最后一条被通过/拒绝/删除后，当前页可能已超出总页数，回退到最后一页重新拉取
        const maxPage = Math.max(1, Math.ceil(res.total / res.pageSize));
        if (page.value > maxPage) {
            page.value = maxPage;
            res = await fetchStickers({
                q: q.value,
                status: status.value,
                page: page.value,
                pageSize: PAGE_SIZE,
            });
        }
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

function emptyEditByKind(): Record<TagKind, string> {
    return { emotion: '', style: '', scene: '', content: '', subject: '', other: '' };
}

function startEdit(item: StickerItem) {
    editingId.value = item._id;
    editSummary.value = item.summary || '';
    const next = emptyEditByKind();
    for (const t of displayTags(item)) {
        const cur = next[t.kind];
        next[t.kind] = cur ? `${cur}, ${t.text}` : t.text;
    }
    editByKind.value = next;
}

function cancelEdit() {
    editingId.value = '';
    editSummary.value = '';
    editByKind.value = emptyEditByKind();
}

function parseTagInput(s: string): string[] {
    return s
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
}

async function saveEdit(item: StickerItem) {
    const summary = editSummary.value.trim();
    if (!summary) {
        err.value = '摘要不能为空';
        return;
    }
    const emotionTags = parseTagInput(editByKind.value.emotion);
    const styleTags = parseTagInput(editByKind.value.style);
    const sceneTags = parseTagInput(editByKind.value.scene);
    const contentTags = parseTagInput(editByKind.value.content);
    const subjectTags = parseTagInput(editByKind.value.subject);
    const otherTags = parseTagInput(editByKind.value.other);
    // 全量 tags：情感 → 主体 → 内容 → 场景 → 其它 → 形式
    const tags = [
        ...emotionTags,
        ...subjectTags,
        ...contentTags,
        ...sceneTags,
        ...otherTags,
        ...styleTags,
    ];
    busyId.value = item._id;
    try {
        const res = await updateSticker(item._id, {
            summary,
            tags,
            emotionTags,
            styleTags,
            sceneTags,
            contentTags,
            subjectTags,
        });
        item.summary = res.summary;
        item.tags = res.tags;
        item.emotionTags = res.emotionTags ?? emotionTags;
        item.styleTags = res.styleTags ?? styleTags;
        item.sceneTags = res.sceneTags ?? sceneTags;
        item.contentTags = res.contentTags ?? contentTags;
        item.subjectTags = res.subjectTags ?? subjectTags;
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

        <!-- 标签颜色图例 -->
        <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span class="mr-0.5">标签：</span>
            <span
                v-for="kind in TAG_KIND_ORDER"
                :key="kind"
                class="inline-flex items-center rounded px-1.5 py-0.5 font-medium"
                :class="TAG_KIND_META[kind].chip"
                :title="TAG_KIND_META[kind].hint"
            >
                {{ TAG_KIND_META[kind].label }}
            </span>
            <span class="ml-1 text-slate-600">选图仅用情感</span>
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

                    <!-- 分类标签：情感 / 形式 / 其它 -->
                    <div
                        v-for="chips in [displayTags(item)]"
                        :key="`tags-${item._id}`"
                        class="min-h-[1.25rem]"
                    >
                        <div v-if="chips.length" class="flex flex-wrap gap-1">
                            <span
                                v-for="t in chips"
                                :key="`${t.kind}:${t.text}`"
                                class="rounded px-1.5 py-0.5 text-[10px]"
                                :class="tagChipClass(t.kind)"
                                :title="TAG_KIND_META[t.kind].label"
                            >
                                {{ t.text }}
                            </span>
                        </div>
                        <div v-else class="text-[10px] text-slate-600">（无标签）</div>
                    </div>

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
                        <label
                            v-for="kind in TAG_KIND_ORDER.filter((k) => k !== 'other')"
                            :key="kind"
                            class="block text-[11px]"
                            :class="TAG_KIND_META[kind].input"
                        >
                            {{ TAG_KIND_META[kind].label }}
                            <span class="ml-1 text-[10px] text-slate-500">{{
                                TAG_KIND_META[kind].hint
                            }}</span>
                            <input
                                v-model="editByKind[kind]"
                                class="input mt-1 w-full text-sm"
                                type="text"
                                :placeholder="
                                    kind === 'emotion'
                                        ? '委屈, 撒娇, 可怜…'
                                        : kind === 'style'
                                          ? 'Q版, 表情包, 动图…'
                                          : kind === 'scene'
                                            ? '雪地, 床边, 绿幕…'
                                            : kind === 'content'
                                              ? '探头, 捂脸, 配文…'
                                              : '白发, 兔耳, 猫…'
                                "
                                @keyup.enter="saveEdit(item)"
                            />
                        </label>
                        <label
                            v-if="editByKind.other.trim()"
                            class="block text-[11px]"
                            :class="TAG_KIND_META.other.input"
                        >
                            其它
                            <span class="ml-1 text-[10px] text-slate-500">未归类</span>
                            <input
                                v-model="editByKind.other"
                                class="input mt-1 w-full text-sm"
                                type="text"
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
