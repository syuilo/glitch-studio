<template>
<div
	:data-test-workspace-panel="panel.id"
	:class="[$style.root, { [$style.collapsed]: collapsed, [$style.horizontal]: stackingDirection === 'horizontal', [$style.verticalHeader]: verticalHeader }]"
>
	<div
		v-if="canDropPanel"
		data-test-workspace-panel-drop="top"
		:class="[$style.dropAreaTop, { [$style.dropReady]: dropReadyArea === 'top' }]"
		@dragover="onDragover($event, 'top')"
		@dragleave="onDragleave($event)"
		@drop="onDrop($event, 'top')"
	></div>
	<div
		v-if="canDropPanel"
		data-test-workspace-panel-drop="bottom"
		:class="[$style.dropAreaBottom, { [$style.dropReady]: dropReadyArea === 'bottom' }]"
		@dragover="onDragover($event, 'bottom')"
		@dragleave="onDragleave($event)"
		@drop="onDrop($event, 'bottom')"
	></div>
	<div
		v-if="canDropPanel"
		data-test-workspace-panel-drop="left"
		:class="[$style.dropAreaLeft, { [$style.dropReady]: dropReadyArea === 'left' }]"
		@dragover="onDragover($event, 'left')"
		@dragleave="onDragleave($event)"
		@drop="onDrop($event, 'left')"
	></div>
	<div
		v-if="canDropPanel"
		data-test-workspace-panel-drop="right"
		:class="[$style.dropAreaRight, { [$style.dropReady]: dropReadyArea === 'right' }]"
		@dragover="onDragover($event, 'right')"
		@dragleave="onDragleave($event)"
		@drop="onDrop($event, 'right')"
	></div>
	<div
		v-if="canDropPanel"
		data-test-workspace-panel-drop="center"
		:class="[$style.dropAreaCenter, { [$style.dropReady]: dropReadyArea === 'center' }]"
		@dragover="onDragover($event, 'center')"
		@dragleave="onDragleave($event)"
		@drop="onDrop($event, 'center')"
	></div>

	<div :class="[$style.main]" tabindex="0">
		<header
			:class="[$style.header]"
			@click="goTop"
		>
			<svg viewBox="0 0 256 128" :class="$style.tabShape">
				<g transform="matrix(6.2431,0,0,6.2431,-677.417,-29.3839)">
					<path d="M149.512,4.707L108.507,4.707C116.252,4.719 118.758,14.958 118.758,14.958C118.758,14.958 121.381,25.283 129.009,25.209L149.512,25.209L149.512,4.707Z" style="fill:var(--THEME-globalBg);"/>
				</g>
			</svg>
			<div :class="$style.headerIndicator"></div>
			<button v-if="canCollapse" :class="$style.toggleCollapse" class="_button" @click="toggleCollapse">
				<template v-if="stackingDirection === 'vertical'">
					<template v-if="collapsed"><i class="ti ti-chevron-down"></i></template>
					<template v-else><i class="ti ti-chevron-up"></i></template>
				</template>
				<template v-else>
					<template v-if="collapsed"><i class="ti ti-chevron-right"></i></template>
					<template v-else><i class="ti ti-chevron-left"></i></template>
				</template>
			</button>
			<span :class="$style.title"><i :class="workspacePanelDefinitions[panel.contentType].icon" style="margin-inline-end: 0.5em;"></i>{{ workspacePanelDefinitions[panel.contentType].label }}</span>
			<button :class="$style.popoutButton" class="_button" @click="popout"><i class="ti ti-external-link"></i></button>
			<div :class="$style.grabber" data-test-workspace-panel-grabber draggable="true" @dragstart.stop="onDragstart">
				<svg viewBox="0 0 16 16" version="1.1" :class="$style.grabberSvg">
					<path fill="currentColor" d="M10 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-4 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5-9a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM6 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
				</svg>
			</div>
			<button :class="$style.menu" class="_button" @click.stop="showSettingsMenu"><i class="ti ti-dots"></i></button>
		</header>
		<div v-if="!collapsed" ref="body" :class="$style.body">
			<GsDetachableView ref="detachableView" :title="workspacePanelDefinitions[panel.contentType].label">
				<component
					:is="workspacePanelDefinitions[panel.contentType].component"
					:panel="panel"
				/>
			</GsDetachableView>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { useTemplateRef, ref, computed, watch } from 'vue';
import GsDetachableView from './GsDetachableView.vue';
import type { MenuItem } from '@/types/menu.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { getElementMenu, workspacePanelDefinitions } from '@/workspace.ts';
import * as ui from '@/ui.ts';
import { useDragSession } from '@/composables/useDragSession.ts';
import { cleanupWorkspaceDefinition, findWorkspaceElement, findWorkspaceParent, splitWorkspaceElement } from '@/utility/workspace.ts';
import { preferences } from '@/preferences.ts';

const props = withDefaults(defineProps<{
	panel: WorkspacePanel;
}>(), {
});

const emit = defineEmits<{
	(ev: 'headerClick', ctx: MouseEvent): void;
}>();

const body = useTemplateRef('body');
const detachableView = useTemplateRef('detachableView');

const parent = computed(() => findWorkspaceParent(preferences.r.workspaceDefinition.value, props.panel.id));
const canCollapse = computed(() => parent.value?.type === 'divider');
const stackingDirection = computed(() => parent.value?.type === 'divider' ? parent.value.direction : 'vertical');
const collapsed = computed(() => canCollapse.value && props.panel.collapsed === true);
// 折りたたみ中は親の分割方向に合わせ、細くなった領域にもヘッダーを収める。
const verticalHeader = computed(() => collapsed.value ? stackingDirection.value === 'horizontal' : props.panel.direction === 'vertical');

function toggleCollapse() {
	const workspace = deepClone(preferences.s.workspaceDefinition);
	const panel = findWorkspaceElement(workspace, props.panel.id);
	if (!panel || panel.type !== 'panel') return;
	panel.collapsed = !panel.collapsed;
	preferences.commit('workspaceDefinition', workspace);
}

function showSettingsMenu(ev: PointerEvent) {
	ui.popupMenu(getElementMenu(props.panel), ev.currentTarget ?? ev.target);
}

function goTop(ev: PointerEvent) {
	emit('headerClick', ev);

	if (body.value) {
		body.value.scrollTo({
			top: 0,
			behavior: 'smooth',
		});
	}
}

const dropReadyArea = ref<'top' | 'bottom' | 'left' | 'right' | 'center' | null>(null);
const dragSession = useDragSession();
const draggedPanel = dragSession.data('WorkspacePanel');
const canDropPanel = computed(() => draggedPanel.value != null && draggedPanel.value.id !== props.panel.id);
watch(draggedPanel, data => { if (data == null) dropReadyArea.value = null; });

function onDragstart(ev: DragEvent) {
	if (ev.dataTransfer == null) return;
	ev.dataTransfer.effectAllowed = 'move';
	dragSession.start(ev, 'WorkspacePanel', { id: props.panel.id });
}

function onDragover(ev: DragEvent, area: 'top' | 'bottom' | 'left' | 'right' | 'center') {
	const data = dragSession.read(ev, 'WorkspacePanel');
	if (data == null || data.id === props.panel.id) return;
	ev.preventDefault();
	ev.stopPropagation();
	if (ev.dataTransfer != null) ev.dataTransfer.dropEffect = 'move';
	dropReadyArea.value = area;
}

function onDragleave(ev: DragEvent) {
	dropReadyArea.value = null;
}

function onDrop(ev: DragEvent, area: 'top' | 'bottom' | 'left' | 'right' | 'center') {
	dropReadyArea.value = null;
	const data = dragSession.read(ev, 'WorkspacePanel');
	if (data == null || data.id === props.panel.id) return;
	ev.preventDefault();
	ev.stopPropagation();
	const draggingId = data.id;

	let workspace = deepClone(preferences.s.workspaceDefinition);
	const sourceParent = findWorkspaceParent(workspace, draggingId);
	const targetParent = findWorkspaceParent(workspace, props.panel.id);
	if (!sourceParent || !targetParent) return;

	const sourceIndex = sourceParent.children.findIndex(child => child.element.id === draggingId);
	const panel = sourceParent.children[sourceIndex];
	if (panel.element.type !== 'panel') return;

	const targetIndex = targetParent.children.findIndex(child => child.element.id === props.panel.id);
	const target = targetParent.children[targetIndex];
	if (target.element.type !== 'panel') return;

	if (area === 'center') {
		// 比率やタブ名は領域に属するため、要素だけを入れ替える。
		[panel.element, target.element] = [target.element, panel.element];
	} else {
		sourceParent.children.splice(sourceIndex, 1);
		const direction = area === 'top' || area === 'bottom' ? 'vertical' : 'horizontal';
		workspace = splitWorkspaceElement(workspace, target.element, panel.element, direction, area === 'top' || area === 'left');
	}
	dragSession.complete(ev);
	preferences.commit('workspaceDefinition', cleanupWorkspaceDefinition(workspace));
}

function popout() {
	detachableView.value?.popout();
}
</script>

<style lang="scss" module>
.root {
	--headerHeight: 30px;

	position: relative;
	height: 100%;

	&.collapsed {
		flex-grow: 0 !important;
		flex-shrink: 0;
		flex-basis: var(--headerHeight);
		min-height: var(--headerHeight);

		&.horizontal {
			min-width: var(--headerHeight);
		}

		&:not(.horizontal) {
			> .main {
				border-bottom-right-radius: 0;
			}
		}
	}
}

.verticalHeader {
	> .main {
		display: flex;
	}

	> .main > .header {
		flex-direction: column;
		flex-shrink: 0;
		align-items: center;
		box-sizing: border-box;
		width: var(--headerHeight);
		height: 100%;
		padding: 14px 0 0;
		background: linear-gradient(-90deg, var(--THEME-panel), hsl(from var(--THEME-panel) h s calc(l + 5)));

		> .tabShape {
			display: none;
		}

		> .headerIndicator {
			width: calc(100% - 24px);
			height: 3px;
		}

		> .title {
			writing-mode: sideways-lr;
			text-align: end;
			flex: 1;
			min-height: 0;
		}

		> .toggleCollapse,
		> .menu,
		> .popoutButton,
		> .grabber {
			flex-shrink: 0;
			margin: 0;
		}

		> .grabber {
			margin-top: 10px;
		}
	}

	> .main > .body {
		flex: 1;
		min-width: 0;
		height: 100%;
	}
}

.main {
	position: relative;
	height: 100%;
	border-radius: 10px;
	overflow: clip;

	&:focus-within {
		box-shadow: 0 0 0 1px color(from var(--THEME-accent) srgb r g b / 0.25);

		.headerIndicator {
			background: var(--THEME-accent);
		}
	}
}

.header {
	position: relative;
	display: flex;
	z-index: 2;
	line-height: var(--headerHeight);
	height: var(--headerHeight);
	padding: 0 16px 0 30px;
	font-size: 85%;
	background: linear-gradient(0deg, var(--THEME-panel), hsl(from var(--THEME-panel) h s calc(l + 5)));
	//background: var(--THEME-panel);
	user-select: none;
}

.headerIndicator {
	position: absolute;
	top: 12px;
	left: 12px;
	width: 3px;
	height: calc(100% - 24px);
	background: #000;
	border-radius: 999px;
}

.tabShape {
	position: absolute;
	top: 0;
	right: -8px;
	width: auto;
	height: calc(100% - 6px);
}

.title {
	display: inline-block;
	align-items: center;
	overflow: clip;
	text-overflow: ellipsis;
	white-space: nowrap;
	width: 100%;
}

.toggleCollapse,
.menu,
.popoutButton {
	z-index: 1;
	width: var(--headerHeight);
	line-height: var(--headerHeight);
	font-size: 90%;
}

.toggleCollapse {
	margin-left: -16px;
}

.popoutButton {
	color: color(from currentColor srgb r g b / 0.5);
	margin-left: auto;
}

.grabber {
	display: grid;
	margin-left: auto;
	margin-right: 10px;
	padding: 8px 8px;
	box-sizing: border-box;
	height: var(--headerHeight);
	cursor: move;
	user-select: none;
	color: color(from currentColor srgb r g b / 0.5);
}

.grabberSvg {
	height: 100%;
	pointer-events: none;
}

.menu {
	margin-right: -16px;
}

.body {
	height: calc(100% - var(--headerHeight));
	overflow: clip;
	contain: strict;
	box-sizing: border-box;
	container-type: size;
	background-color: var(--THEME-panel);
}

.dropAreaTop, .dropAreaBottom, .dropAreaLeft, .dropAreaRight, .dropAreaCenter {
	position: absolute;
	z-index: 10;
	//background: color(from var(--THEME-accent) srgb r g b / 0.2);
}
.dropAreaTop {
	top: 0;
	left: 0;
	width: 100%;
	height: 25%;
}
.dropAreaBottom {
	bottom: 0;
	left: 0;
	width: 100%;
	height: 25%;
}
.dropAreaLeft {
	top: 0;
	left: 0;
	width: 25%;
	height: 100%;
}
.dropAreaRight {
	top: 0;
	right: 0;
	width: 25%;
	height: 100%;
}
.dropAreaCenter {
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	margin: auto;
	width: 55%;
	height: 50%;
}

.dropReady {
	background: color(from var(--THEME-accent) srgb r g b / 0.25);
}
</style>
