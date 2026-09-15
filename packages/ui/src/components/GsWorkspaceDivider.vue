<template>
<div ref="root" :class="[$style.root, { [$style.horizontal]: divider.direction === 'horizontal', [$style.vertical]: divider.direction === 'vertical' }]">
	<template v-for="(child, i) in divider.children" :key="child.id">
		<GsWorkspaceDivider
			v-if="child.type === null"
			:divider="child"
			:class="$style.child"
			:style="{ flexGrow: child.ratio / totalRatio }"
		/>
		<component
			:is="panelComponents[child.type]"
			v-else
			:ref="child.id"
			:key="child.id"
			:panel="child"
			:class="$style.child"
			:style="{ flexGrow: child.ratio / totalRatio }"
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
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import type { WorkspaceDivider } from '@/types/workspace.ts';
import XEmpty from '@/components/GsWorkspacePanel.Empty.vue';
import XPreview from '@/components/GsWorkspacePanel.Preview.vue';
import XNodesEditor from '@/components/GsWorkspacePanel.NodesEditor.vue';
import XHistogram from '@/components/GsWorkspacePanel.Histogram.vue';
import XWaveform from '@/components/GsWorkspacePanel.Waveform.vue';
import XAudioSpectrum from '@/components/GsWorkspacePanel.AudioSpectrum.vue';
import XAudioSpectrogram from '@/components/GsWorkspacePanel.AudioSpectrogram.vue';
import XAudioWaveform from '@/components/GsWorkspacePanel.AudioWaveform.vue';
import XStats from '@/components/GsWorkspacePanel.Stats.vue';
import XCommandLog from '@/components/GsWorkspacePanel.CommandLog.vue';
import XMacros from '@/components/GsWorkspacePanel.Macros.vue';
import XPlayers from '@/components/GsWorkspacePanel.Players.vue';
import XTimeline from '@/components/GsWorkspacePanel.Timeline.vue';
import { appContext, workspacePanelDraggingContext } from '@/app.ts';
import { cleanupWorkspaceDefinition, findWorkspaceParent } from '@/utility/workspace.ts';

const panelComponents = {
	empty: XEmpty,
	preview: XPreview,
	nodesEditor: XNodesEditor,
	histogram: XHistogram,
	waveform: XWaveform,
	waveformHorizontal: XWaveform,
	waveformVertical: XWaveform,
	audioSpectrum: XAudioSpectrum,
	audioSpectrogram: XAudioSpectrogram,
	audioWaveform: XAudioWaveform,
	stats: XStats,
	commandLog: XCommandLog,
	macros: XMacros,
	players: XPlayers,
	timeline: XTimeline,
};

const props = withDefaults(defineProps<{
	divider: WorkspaceDivider;
}>(), {

});

const root = useTemplateRef('root');

// flex-grow の合計が 1 未満だと余白が残るため、兄弟間で正規化
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
	before: WorkspaceDivider['children'][number];
	after: WorkspaceDivider['children'][number];
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
		before,
		after,
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

	dragState.before.ratio = beforeRatio;
	dragState.after.ratio = dragState.pairRatio - beforeRatio;
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

	const workspace = appContext.workspaceDefinition.value;
	const sourceParent = findWorkspaceParent(workspace, draggingId);
	if (!sourceParent) return;

	const sourceIndex = sourceParent.children.findIndex(child => child.id === draggingId);
	const panel = sourceParent.children[sourceIndex];
	if (panel.type === null) return;

	let insertionIndex = index + 1;
	if (sourceParent === props.divider) {
		if (sourceIndex < insertionIndex) insertionIndex--;
	} else {
		// 別のdividerから移す場合は、移動先の子の平均サイズを割り当てる。
		panel.ratio = totalRatio.value / props.divider.children.length;
	}
	sourceParent.children.splice(sourceIndex, 1);
	props.divider.children.splice(insertionIndex, 0, panel);
	cleanupWorkspaceDefinition(workspace);
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
