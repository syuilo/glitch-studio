<template>
<TransitionGroup
	tag="div"
	:enterActiveClass="$style.transition_items_enterActive"
	:leaveActiveClass="$style.transition_items_leaveActive"
	:enterFromClass="$style.transition_items_enterFrom"
	:leaveToClass="$style.transition_items_leaveTo"
	:moveClass="$style.transition_items_move"
	:class="[$style.items, { [$style.dragging]: dragging, [$style.horizontal]: direction === 'horizontal', [$style.vertical]: direction === 'vertical', [$style.withGaps]: withGaps, [$style.canNest]: canNest }]"
>
	<slot name="header"></slot>
	<div
		v-if="modelValue.length === 0"
		:class="$style.emptyDropArea"
		@dragover.prevent.stop="() => {}"
		@dragleave="() => {}"
		@drop.prevent.stop="onEmptyDrop($event)"
	>
	</div>
	<!-- 並べ替えには全件を保持し、描画だけを仮想一覧などへ委ねられる。 -->
	<slot name="items" :renderItem="renderItem" :draggingId="draggingId">
		<component :is="renderItem" v-for="(item, index) in modelValue" :key="item.id" :item="item" :index="index"/>
	</slot>
	<slot name="footer"></slot>
</TransitionGroup>
</template>

<script lang="ts">
import { ref } from 'vue';

// 別々のコンポーネントインスタンス間でD&Dを融通するためにグローバルに状態を持っておく必要がある
const dragging = ref(false);
let dropCallback: ((targetInstanceId: string) => void) | null = null;
</script>

<script lang="ts" setup generic="T extends { id: string; }">
import { genId } from '@gs/shared/utility/id.js';
import { h, nextTick, onBeforeUnmount, useCssModule } from 'vue';
import type { FunctionalComponent } from 'vue';
import { getDragData, setDragData } from '@/utility/drag-and-drop.ts';

const slots = defineSlots<{
	default(props: { item: T; index: number; dragStart: (ev: DragEvent) => void }): any;
	header(): any;
	footer(): any;
	items(props: { renderItem: FunctionalComponent<{ item: T; index: number }>; draggingId: string | null }): any;
}>();

const props = withDefaults(defineProps<{
	modelValue: T[];
	direction: 'horizontal' | 'vertical';
	group?: string | null;
	manualDragStart?: boolean;
	withGaps?: boolean;
	canNest?: boolean;
}>(), {
	group: null,
	manualDragStart: false,
	withGaps: false,
	canNest: false,
});

const emit = defineEmits<{
	(ev: 'update:modelValue', value: T[]): void;
}>();

const dropReadyArea = ref<[T['id'] | null, 'forward' | 'backward' | null]>([null, null]);
const instanceId = genId();
const group = props.group ?? instanceId;
const style = useCssModule();
const draggingId = ref<string | null>(null);
let finishDrag: (() => void) | undefined;

// 同じ行コンポーネントを通常一覧と仮想一覧で共有し、ドロップ領域の仕様を二重管理しない。
const renderItem: FunctionalComponent<{ item: T; index: number }> = ({ item, index }) => {
	const dropArea = (backward: boolean) => h('div', {
		class: [backward ? style.backwardArea : style.forwardArea, { [style.dropReady]: dropReadyArea.value[0] === item.id && dropReadyArea.value[1] === (backward ? 'backward' : 'forward') }],
		onDragover: (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); onDragover(event, item, backward); },
		onDragleave: (event: DragEvent) => onDragleave(event, item),
		onDrop: (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); onDrop(event, item, backward); },
	});
	return h('section', {
		class: style.item,
		draggable: !props.manualDragStart,
		onDragstart: (event: DragEvent) => { event.stopPropagation(); onDragstart(event, item); },
	}, [dropArea(false), h('div', { style: { position: 'relative', zIndex: 0 } }, slots.default({ item, index, dragStart: event => onDragstart(event, item) })), dropArea(true)]);
};
onBeforeUnmount(() => finishDrag?.());

function onDragstart(ev: DragEvent, item: T) {
	if (ev.dataTransfer == null) return;
	finishDrag?.();
	ev.dataTransfer.effectAllowed = 'move';
	setDragData(ev, 'GsDraggable', { item, instanceId, group });

	const target = ev.target as HTMLElement;
	const ownerWindow = target.ownerDocument.defaultView!;
	const finish = () => {
		ownerWindow.clearTimeout(timer);
		target.removeEventListener('dragend', finish);
		ownerWindow.removeEventListener('blur', finish);
		dragging.value = false;
		draggingId.value = null;
		dropReadyArea.value = [null, null];
		dropCallback = null;
		finishDrag = undefined;
	};
	finishDrag = finish;
	target.addEventListener('dragend', finish, { once: true });
	ownerWindow.addEventListener('blur', finish);

	dropCallback = (targetInstanceId) => {
		if (targetInstanceId === instanceId) return;
		const newValue = props.modelValue.filter(x => x.id !== item.id);
		emit('update:modelValue', newValue);
	};

	// Chromeのバグで、Dragstartハンドラ内ですぐにDOMを変更する(=リアクティブなプロパティを変更する)とDragが終了してしまう
	// SEE: https://stackoverflow.com/questions/19639969/html5-dragend-event-firing-immediately
	// SEE: https://issues.chromium.org/issues/41150279
	const timer = ownerWindow.setTimeout(() => {
		dragging.value = true;
		draggingId.value = item.id;
	}, 10);
}

function onDragover(ev: DragEvent, item: T, backward: boolean) {
	nextTick(() => {
		dropReadyArea.value = [item.id, backward ? 'backward' : 'forward'];
	});
}

function onDragleave(ev: DragEvent, item: T) {
	dropReadyArea.value = [null, null];
}

function onDrop(ev: DragEvent, item: T, backward: boolean) {
	const dragged = getDragData(ev, 'GsDraggable');
	dropReadyArea.value = [null, null];
	if (dragged == null || dragged.group !== group || dragged.item.id === item.id) return;
	dropCallback?.(instanceId);

	const fromIndex = props.modelValue.findIndex(x => x.id === dragged.item.id);
	let toIndex = props.modelValue.findIndex(x => x.id === item.id);

	const newValue = [...props.modelValue];
	const movedItem = fromIndex > -1 ? newValue[fromIndex] : dragged.item as T;
	if (fromIndex > -1) newValue.splice(fromIndex, 1);
	toIndex = newValue.findIndex(x => x.id === item.id);
	if (backward) toIndex += 1;
	newValue.splice(toIndex, 0, movedItem);

	emit('update:modelValue', newValue);
}

function onEmptyDrop(ev: DragEvent) {
	const dragged = getDragData(ev, 'GsDraggable');
	if (dragged == null) return;
	dropCallback?.(instanceId);

	emit('update:modelValue', [dragged.item as T]);
}
</script>

<style lang="scss" module>
.transition_items_move,
.transition_items_enterActive,
.transition_items_leaveActive {
	transition: all 0.15s ease;
}
.transition_items_enterFrom,
.transition_items_leaveTo {
	opacity: 0;
}
.transition_items_leaveActive {
	position: absolute;
}

.items {
	--margin: var(--DRAGGABLE_MARGIN, 8px);

	display: flex;
	align-items: center;
	justify-content: left;
	flex-wrap: wrap;
}

.items.horizontal {
	flex-direction: row;
}
.items.vertical {
	flex-direction: column;
}

.item {
	position: relative;
}

.items.vertical .item {
	width: 100%;
}

.items.horizontal.withGaps {
	row-gap: var(--margin);
}

.items.horizontal.withGaps .item {
	padding-left: calc(var(--margin) / 2);
	padding-right: calc(var(--margin) / 2);

	&:first-of-type {
		padding-left: 0;

		.forwardArea {
			left: calc(0px - (var(--margin) / 2));
		}
	}
	&:last-of-type {
		padding-right: 0;

		.backwardArea {
			right: calc(0px - (var(--margin) / 2));
		}
	}
}

.items.vertical.withGaps .item {
	padding-top: calc(var(--margin) / 2);
	padding-bottom: calc(var(--margin) / 2);

	&:first-of-type {
		padding-top: 0;

		.forwardArea {
			top: calc(0px - (var(--margin) / 2));
		}
	}
	&:last-of-type {
		padding-bottom: 0;

		.backwardArea {
			bottom: calc(0px - (var(--margin) / 2));
		}
	}
}

.forwardArea, .backwardArea {
	position: absolute;
	z-index: 1;
	pointer-events: none;
}

.items.dragging {
	.forwardArea, .backwardArea {
		pointer-events: auto;
	}
}

.items.horizontal {
	.forwardArea {
		top: 0;
		left: 0;
		width: 50%;
		height: 100%;
	}

	.backwardArea {
		top: 0;
		right: 0;
		width: 50%;
		height: 100%;
	}
}

.items.vertical {
	.forwardArea {
		top: calc(var(--DRAGGABLE_DROP_GAP, 0px) / -2);
		left: 0;
		width: 100%;
		height: calc(50% + var(--DRAGGABLE_DROP_GAP, 0px) / 2);
	}

	.backwardArea {
		bottom: calc(var(--DRAGGABLE_DROP_GAP, 0px) / -2);
		left: 0;
		width: 100%;
		height: calc(50% + var(--DRAGGABLE_DROP_GAP, 0px) / 2);
	}
}

.items.canNest.horizontal {
	.forwardArea, .backwardArea {
		width: 30px;
	}
}

.items.canNest.vertical {
	.forwardArea, .backwardArea {
		height: 30px;
	}
}

.dropReady::before {
	content: '';
	position: absolute;
	z-index: 99999;
	background: var(--THEME-accent);
	border-radius: 999px;
	pointer-events: none;
}

.items.horizontal {
	.forwardArea.dropReady::before {
		top: 0;
		left: -1px;
		width: 2px;
		height: 100%;
	}

	.backwardArea.dropReady::before {
		top: 0;
		right: -1px;
		width: 2px;
		height: 100%;
	}
}

.items.vertical {
	.forwardArea.dropReady::before {
		top: -1px;
		left: 0;
		width: 100%;
		height: 2px;
	}

	.backwardArea.dropReady::before {
		bottom: -1px;
		left: 0;
		width: 100%;
		height: 2px;
	}
}

.items.horizontal .emptyDropArea {
	width: 40px;
	height: 40px;
}

.items.vertical .emptyDropArea {
	width: 100%;
	height: 50px;
}
</style>
