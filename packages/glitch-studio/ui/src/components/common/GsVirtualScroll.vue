<template>
<div ref="root" :class="$style.root">
	<template v-for="entry in renderedItems" :key="entry.key">
		<div v-if="entry.spacer > 0" :style="{ height: entry.spacer + 'px' }"></div>
		<div :ref="element => setItemElement(entry.key, element)" :class="$style.item">
			<slot :item="entry.item" :index="entry.index"></slot>
		</div>
	</template>
	<div :style="{ height: trailingSpace + 'px' }"></div>
</div>
</template>

<script setup lang="ts" generic="T">
import { computed, nextTick, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import type { VirtualScrollKey } from '@/utility/virtual-scroll.ts';
import { createVirtualScrollLayout, findVirtualScrollItem, getVirtualScrollAnchorOffset, getVirtualScrollItems } from '@/utility/virtual-scroll.ts';

const props = withDefaults(defineProps<{
	items: readonly T[];
	itemKey: (item: T) => VirtualScrollKey;
	scrollElement: HTMLElement | null;
	estimatedItemHeight: number;
	overscan?: number;
	gap?: number;
	keepMountedKeys?: readonly VirtualScrollKey[];
	/** 画面外の内容変更でも古い実測高を無効化できる、サイズに関係する識別値。 */
	itemSizeKey?: (item: T) => unknown;
}>(), { overscan: 300, gap: 0, keepMountedKeys: () => [] });
defineSlots<{ default(props: { item: T; index: number }): any }>();
const emit = defineEmits<{ layout: [] }>();
const root = useTemplateRef('root');
const heights = new Map<VirtualScrollKey, number>();
const elements = new Map<VirtualScrollKey, HTMLElement>();
const layout = shallowRef(createVirtualScrollLayout([], heights, props.estimatedItemHeight, props.gap));
const viewport = shallowRef({ top: 0, height: 0 });
let observer: ResizeObserver | undefined;
let disposed = false;
let pending: Promise<void> | undefined;
let dirty = false;
let layoutDirty = true;
let itemKeys: VirtualScrollKey[] = [];
let measuredWidth: number | undefined;
const currentItems = computed(() => new Map(props.items.map((item, index) => [props.itemKey(item), { item, index }])));

const renderedItems = computed(() => {
	const visible = getVirtualScrollItems(layout.value, viewport.value.top - props.overscan, viewport.value.top + viewport.value.height + props.overscan, props.keepMountedKeys);
	let end = 0;
	return visible.flatMap(item => {
		// propsの追加・削除が先に描画されても、旧indexで別の項目を計測しない。
		const current = currentItems.value.get(item.key);
		if (!current) return [];
		const spacer = item.top - end;
		end = item.top + item.height;
		return [{ ...item, ...current, spacer }];
	});
});
const trailingSpace = computed(() => {
	const last = renderedItems.value.at(-1);
	return layout.value.height - (last ? last.top + last.height : 0);
});

function listOffset() {
	const scroller = props.scrollElement;
	return root.value && scroller ? root.value.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop : 0;
}

function syncViewport() {
	const scroller = props.scrollElement;
	if (!scroller) return;
	const top = scroller.scrollTop - listOffset();
	if (top !== viewport.value.top || scroller.clientHeight !== viewport.value.height) viewport.value = { top, height: scroller.clientHeight };
}

function setItemElement(key: VirtualScrollKey, value: Element | ComponentPublicInstance | null) {
	const previous = elements.get(key);
	const element = value as HTMLElement | null;
	if (previous === element) return;
	if (previous) observer?.unobserve(previous);
	if (element) {
		elements.set(key, element);
		observer?.observe(element, { box: 'border-box' });
	} else elements.delete(key);
}

/** 描画→実測→補正をまとめる。大きな推定誤差でも、可視範囲が実測で埋まるまで追従する。 */
function refresh(): Promise<void> {
	dirty = true;
	if (pending) return pending;
	pending = (async () => {
		let changed = false;
		while (dirty && !disposed) {
			dirty = false;
			syncViewport();
			await nextTick();
			const scroller = props.scrollElement;
			const container = root.value;
			// 非表示パネルの0を計測値にすると一覧全体が潰れるため、再表示まで保持する。
			if (!scroller || !container || scroller.clientHeight === 0 || container.getBoundingClientRect().width === 0) break;
			const width = container.getBoundingClientRect().width;
			if (measuredWidth !== undefined && measuredWidth !== width) { heights.clear(); layoutDirty = true; }
			measuredWidth = width;
			for (const [key, element] of elements) {
				const height = element.getBoundingClientRect().height;
				if (heights.get(key) !== height) { heights.set(key, height); layoutDirty = true; }
			}
			if (!layoutDirty) continue;
			layoutDirty = false;
			const previous = layout.value;
			const next = createVirtualScrollLayout(itemKeys, heights, props.estimatedItemHeight, props.gap);
			if (next.items.length === previous.items.length && next.items.every((item, index) => {
				const old = previous.items[index];
				return item.key === old.key && item.height === old.height && item.top === old.top;
			})) continue;
			const oldScrollTop = scroller.scrollTop;
			const offset = listOffset();
			const nextTop = getVirtualScrollAnchorOffset(previous, next, oldScrollTop - offset);
			layout.value = next;
			changed = true;
			await nextTick();
			// 補正はDOMの全高更新後に行う。待機中のユーザー操作を古い位置で上書きしない。
			if (scroller.scrollTop === oldScrollTop || oldScrollTop > scroller.scrollHeight - scroller.clientHeight) scroller.scrollTop = offset + nextTop;
			dirty = true;
		}
		if (changed && !disposed) emit('layout');
	})().finally(() => { pending = undefined; });
	return pending;
}

function invalidate(keys?: readonly VirtualScrollKey[]) {
	if (keys) for (const key of keys) heights.delete(key);
	else heights.clear();
	layoutDirty = true;
	void refresh();
}

watch(() => props.items.map(item => ({ key: props.itemKey(item), size: props.itemSizeKey?.(item) })), (items, previous) => {
	const previousSizes = new Map(previous?.map(item => [item.key, item.size]));
	const keys = new Set(items.map(item => item.key));
	itemKeys = items.map(item => item.key);
	layoutDirty = true;
	for (const key of heights.keys()) if (!keys.has(key)) heights.delete(key);
	for (const item of items) if (previousSizes.get(item.key) !== item.size) heights.delete(item.key);
	void refresh();
}, { immediate: true });
watch(() => [props.estimatedItemHeight, props.gap], () => { layoutDirty = true; void refresh(); });
watch([root, () => props.scrollElement], ([container, scroller], _previous, onCleanup) => {
	if (!container || !scroller) return;
	// スクロール補正はこのコンポーネントが所有し、ブラウザー側の補正との二重適用を防ぐ。
	const previousAnchor = scroller.style.overflowAnchor;
	scroller.style.overflowAnchor = 'none';
	const onScroll = () => { syncViewport(); void refresh(); };
	scroller.addEventListener('scroll', onScroll, { passive: true });
	observer = new ResizeObserver(() => { void refresh(); });
	observer.observe(scroller);
	observer.observe(container);
	for (const element of elements.values()) observer.observe(element, { box: 'border-box' });
	void refresh();
	onCleanup(() => {
		scroller.removeEventListener('scroll', onScroll);
		scroller.style.overflowAnchor = previousAnchor;
		observer?.disconnect();
		observer = undefined;
	});
}, { flush: 'post' });
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); });

// 座標は一覧上端を0とする。Timeline等の利用側は自分のドメインの行内座標と組み合わせる。
defineExpose({
	refresh,
	invalidate,
	getLayout: () => layout.value,
	getItemAt: (y: number) => findVirtualScrollItem(layout.value, y),
	getViewportTop: () => { syncViewport(); return viewport.value.top; },
	getClientTop: () => root.value?.getBoundingClientRect().top ?? 0,
});
</script>

<style module>
.root {
	width: 100%;
	flex-shrink: 0;
	overflow-anchor: none;
}
.item {
	display: flow-root;
}
</style>
