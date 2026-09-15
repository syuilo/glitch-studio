<template>
<div ref="root" :class="[$style.root, { [$style.horizontal]: divider.direction === 'horizontal', [$style.vertical]: divider.direction === 'vertical' }]">
	<template v-for="(child, i) in divider.children" :key="child.element.id">
		<GsWorkspaceElement
			:element="child.element"
			:class="$style.child"
			:style="{ flexGrow: `calc(${child.ratio} / ${minimumRatioCss})` }"
		/>
		<div
			v-if="i < divider.children.length - 1"
			:class="$style.handle"
			@pointerdown.prevent="onPointerDown($event, i)"
			@pointermove="onPointerMove"
			@pointerup="onPointerEnd"
			@pointercancel="onPointerEnd"
		>
			<div
				v-if="workspacePanelDraggingContext.draggingId.value != null"
				:class="[$style.dropArea, { [$style.dropReady]: dropReadyIndex === i }]"
				@dragover.prevent.stop="onDragover($event, i)"
				@dragleave="onDragleave($event)"
				@drop.prevent.stop="onDrop($event, i)"
			></div>
		</div>
	</template>
</div>
</template>

<script lang="ts" setup>
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import type { WorkspaceDivider } from '@/workspace';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';
import { appContext, workspacePanelDraggingContext } from '@/app.ts';
import { cleanupWorkspaceDefinition, findWorkspaceParent } from '@/utility/workspace.ts';
import { preferences } from '@/preferences.ts';

const props = withDefaults(defineProps<{
	divider: WorkspaceDivider;
}>(), {

});

const root = useTemplateRef('root');

// 各 flex-grow を 1 以上にし、collapse で兄弟が縮んでも残りのパネルで余白を埋める。
// 共通の最小値で割るため、ratio 自体を変更せずパネル間の比率を維持できる。
const minimumRatioCss = computed(() => `min(${props.divider.children.map(child => child.ratio).join(', ')})`);
const totalRatio = computed(() => props.divider.children.reduce((total, child) => total + child.ratio, 0));

const handleSize = 5;
const minPanelSize = 32;

let dragState: {
	pointerId: number;
	target: HTMLElement;
	startPosition: number;
	startRatio: number;
	pairRatio: number;
	totalRatio: number;
	availableSize: number;
	beforeId: string;
	afterId: string;
} | null = null;

function onPointerDown(ev: PointerEvent, index: number) {
	if (ev.button !== 0 || root.value == null || !(ev.currentTarget instanceof HTMLElement)) return;

	const before = props.divider.children[index];
	const after = props.divider.children[index + 1];
	const rect = root.value.getBoundingClientRect();
	const size = props.divider.direction === 'horizontal' ? rect.width : rect.height;
	const availableSize = size - handleSize * (props.divider.children.length - 1);
	const totalRatio = props.divider.children.reduce((total, child) => total + child.ratio, 0);

	if (availableSize <= 0 || totalRatio <= 0) return;

	dragState = {
		pointerId: ev.pointerId,
		target: ev.currentTarget,
		startPosition: props.divider.direction === 'horizontal' ? ev.clientX : ev.clientY,
		startRatio: before.ratio,
		pairRatio: before.ratio + after.ratio,
		totalRatio,
		availableSize,
		beforeId: before.id,
		afterId: after.id,
	};

	ev.currentTarget.setPointerCapture(ev.pointerId);
}

function onPointerMove(ev: PointerEvent) {
	if (dragState == null || ev.pointerId !== dragState.pointerId) return;

	const position = props.divider.direction === 'horizontal' ? ev.clientX : ev.clientY;
	const deltaRatio = (position - dragState.startPosition) / dragState.availableSize * dragState.totalRatio;
	const minRatio = Math.min(minPanelSize / dragState.availableSize * dragState.totalRatio, dragState.pairRatio / 2);
	const beforeRatio = Math.min(
		dragState.pairRatio - minRatio,
		Math.max(minRatio, dragState.startRatio + deltaRatio),
	);

	const { beforeId, afterId } = dragState;
	const workspace = deepClone(preferences.s.workspaceDefinition);
	const parent = findWorkspaceParent(workspace, beforeId);
	const before = parent?.children.find(child => child.id === beforeId);
	const after = parent?.children.find(child => child.id === afterId);
	if (!before || !after) return;
	before.ratio = beforeRatio;
	after.ratio = dragState.pairRatio - beforeRatio;
	preferences.commit('workspaceDefinition', workspace);
}

function onPointerEnd(ev: PointerEvent) {
	if (dragState == null || ev.pointerId !== dragState.pointerId) return;

	const { target, pointerId } = dragState;
	dragState = null;
	if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
}

const dropReadyIndex = ref<number | null>(null);

function onDragover(ev: DragEvent, index: number) {
	nextTick(() => {
		dropReadyIndex.value = index;
	});
}

function onDragleave(ev: DragEvent) {
	dropReadyIndex.value = null;
}

function onDrop(ev: DragEvent, index: number) {
	dropReadyIndex.value = null;
	const draggingId = workspacePanelDraggingContext.draggingId.value;
	workspacePanelDraggingContext.draggingId.value = null;
	if (draggingId == null) return;

	const workspace = deepClone(preferences.s.workspaceDefinition);
	const sourceParent = findWorkspaceParent(workspace, draggingId);
	if (!sourceParent) return;

	const sourceIndex = sourceParent.children.findIndex(child => child.id === draggingId);
	const panel = sourceParent.children[sourceIndex];
	if (panel.type === null) return;

	const target = workspace.id === props.divider.id
		? workspace
		: findWorkspaceParent(workspace, props.divider.id)?.children.find(child => child.id === props.divider.id);
	if (!target || target.type !== null) return;

	let insertionIndex = index + 1;
	if (sourceParent === target) {
		if (sourceIndex < insertionIndex) insertionIndex--;
	} else {
		// 別のdividerから移す場合は、移動先の子の平均サイズを割り当てる。
		panel.ratio = totalRatio.value / props.divider.children.length;
	}
	sourceParent.children.splice(sourceIndex, 1);
	target.children.splice(insertionIndex, 0, panel);
	preferences.commit('workspaceDefinition', cleanupWorkspaceDefinition(workspace));
}

</script>

<style module lang="scss">
.root {
	display: flex;
	min-width: 0;
	min-height: 0;
}

.child {
	flex-basis: 0;
	min-width: 0;
	min-height: 0;
}

.handle {
	position: relative;
	flex: 0 0 5px;
	touch-action: none;
}

.dropArea {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 20;
}

.dropReady {
	background: color(from var(--THEME-accent) srgb r g b / 0.25);
}

.horizontal {
	flex-direction: row;

	> .handle {
		cursor: col-resize;

		> .dropArea { // このコンポーネントが入れ子になってる時に別のインスタンスのクラスに影響されてしまうため > が必要
			width: calc(100% + 16px);
			height: 100%;
			left: -8px;
		}
	}
}

.vertical {
	flex-direction: column;

	> .handle {
		cursor: row-resize;

		> .dropArea { // このコンポーネントが入れ子になってる時に別のインスタンスのクラスに影響されてしまうため > が必要
			width: 100%;
			height: calc(100% + 16px);
			top: -8px;
		}
	}
}

</style>
