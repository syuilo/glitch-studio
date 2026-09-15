<template>
<div
	:class="[$style.root]"
>
	<div
		v-if="workspacePanelDraggingContext.draggingId.value != null && workspacePanelDraggingContext.draggingId.value !== panel.id"
		:class="[$style.dropAreaTop, { [$style.dropReady]: dropReadyArea === 'top' }]"
		@dragover.prevent.stop="onDragover($event, 'top')"
		@dragleave="onDragleave($event)"
		@drop.prevent.stop="onDrop($event, 'top')"
	></div>
	<div
		v-if="workspacePanelDraggingContext.draggingId.value != null && workspacePanelDraggingContext.draggingId.value !== panel.id"
		:class="[$style.dropAreaBottom, { [$style.dropReady]: dropReadyArea === 'bottom' }]"
		@dragover.prevent.stop="onDragover($event, 'bottom')"
		@dragleave="onDragleave($event)"
		@drop.prevent.stop="onDrop($event, 'bottom')"
	></div>
	<div
		v-if="workspacePanelDraggingContext.draggingId.value != null && workspacePanelDraggingContext.draggingId.value !== panel.id"
		:class="[$style.dropAreaLeft, { [$style.dropReady]: dropReadyArea === 'left' }]"
		@dragover.prevent.stop="onDragover($event, 'left')"
		@dragleave="onDragleave($event)"
		@drop.prevent.stop="onDrop($event, 'left')"
	></div>
	<div
		v-if="workspacePanelDraggingContext.draggingId.value != null && workspacePanelDraggingContext.draggingId.value !== panel.id"
		:class="[$style.dropAreaRight, { [$style.dropReady]: dropReadyArea === 'right' }]"
		@dragover.prevent.stop="onDragover($event, 'right')"
		@dragleave="onDragleave($event)"
		@drop.prevent.stop="onDrop($event, 'right')"
	></div>
	<div
		v-if="workspacePanelDraggingContext.draggingId.value != null && workspacePanelDraggingContext.draggingId.value !== panel.id"
		:class="[$style.dropAreaCenter, { [$style.dropReady]: dropReadyArea === 'center' }]"
		@dragover.prevent.stop="onDragover($event, 'center')"
		@dragleave="onDragleave($event)"
		@drop.prevent.stop="onDrop($event, 'center')"
	></div>

	<div :class="[$style.main, { [$style.active]: active }]">
		<header
			:class="[$style.header]"
			@click="goTop"
		>
			<svg viewBox="0 0 256 128" :class="$style.tabShape">
				<g transform="matrix(6.2431,0,0,6.2431,-677.417,-29.3839)">
					<path d="M149.512,4.707L108.507,4.707C116.252,4.719 118.758,14.958 118.758,14.958C118.758,14.958 121.381,25.283 129.009,25.209L149.512,25.209L149.512,4.707Z" style="fill:var(--THEME-bg);"/>
				</g>
			</svg>
			<div :class="$style.color"></div>
			<button :class="$style.toggleActive" class="_button" @click="toggleActive">
				<template v-if="active"><i class="ti ti-chevron-up"></i></template>
				<template v-else><i class="ti ti-chevron-down"></i></template>
			</button>
			<span :class="$style.title"><slot name="header"></slot></span>
			<div :class="$style.grabber" draggable="true" @dragstart.stop="onDragstart">
				<svg viewBox="0 0 16 16" version="1.1" :class="$style.grabberSvg">
					<path fill="currentColor" d="M10 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-4 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5-9a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM6 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
				</svg>
			</div>
			<button :class="$style.menu" class="_button" @click.stop="showSettingsMenu"><i class="ti ti-dots"></i></button>
		</header>
		<div v-if="active" ref="body" :class="$style.body">
			<slot></slot>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { onBeforeUnmount, onMounted, provide, watch, useTemplateRef, ref, computed, nextTick } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import type { MenuItem } from '@/types/menu.ts';
import type { WorkspacePanel } from '@/types/workspace.ts';
import { workspacePanelChoices } from '@/types/workspace.ts';
import * as ui from '@/ui.ts';
import { i18n } from '@/i18n.ts';
import { appContext, workspacePanelDraggingContext } from '@/app.ts';
import { getDragData, setDragData } from '@/utility/drag-and-drop.ts';
import { cleanupWorkspaceDefinition, findWorkspaceParent, splitWorkspacePanel } from '@/utility/workspace.ts';
import { preferences } from '@/preferences.ts';
//import { checkDragDataType, getDragData, setDragData } from '@/drag-and-drop.ts';

const props = withDefaults(defineProps<{
	panel: WorkspacePanel;
	handleScrollToTop?: boolean;
	menu?: MenuItem[];
}>(), {
	handleScrollToTop: true,
});

const emit = defineEmits<{
	(ev: 'headerClick', ctx: MouseEvent): void;
}>();

const body = useTemplateRef('body');

const stackingDirection = computed(() => {
	// TODO
});
const active = computed(() => props.panel.active !== false);

function toggleActive() {
}

function addPanel(position: 'below' | 'above' | 'left' | 'right') {
	const workspace = deepClone(preferences.s.workspaceDefinition);
	const parent = findWorkspaceParent(workspace, props.panel.id);
	if (!parent) return;

	const direction = position === 'below' || position === 'above' ? 'vertical' : 'horizontal';
	const before = position === 'above' || position === 'left';
	const panel: WorkspacePanel = { id: genId(), type: 'empty', ratio: 1 };
	const target = parent.children.find(child => child.id === props.panel.id);
	if (!target || target.type === null) return;
	splitWorkspacePanel(parent, target, panel, direction, before);
	preferences.commit('workspaceDefinition', cleanupWorkspaceDefinition(workspace));
}

function closePanel() {
	const workspace = deepClone(preferences.s.workspaceDefinition);
	const parent = findWorkspaceParent(workspace, props.panel.id);
	if (!parent) return;

	const index = parent.children.findIndex(child => child.id === props.panel.id);
	parent.children.splice(index, 1);
	preferences.commit('workspaceDefinition', cleanupWorkspaceDefinition(workspace));
}

function getMenu() {
	const menuItems: MenuItem[] = [];

	if (props.menu) {
		menuItems.push(...props.menu);
	}

	if (menuItems.length > 0) {
		menuItems.push({
			type: 'divider',
		});
	}

	menuItems.push({
		type: 'parent',
		text: 'Switch type to',
		children: workspacePanelChoices.map(choice => ({
			text: choice.label,
			action: () => {
				const workspace = deepClone(preferences.s.workspaceDefinition);
				const parent = findWorkspaceParent(workspace, props.panel.id);
				const panel = parent?.children.find(child => child.id === props.panel.id);
				if (!panel || panel.type === null) return;
				panel.type = choice.type;
				preferences.commit('workspaceDefinition', workspace);
			},
		})),
	}, { type: 'divider' }, {
		icon: 'ti ti-box-align-top',
		text: 'Add panel to above',
		action: () => addPanel('above'),
	}, {
		icon: 'ti ti-box-align-bottom',
		text: 'Add panel to below',
		action: () => addPanel('below'),
	}, {
		icon: 'ti ti-box-align-left',
		text: 'Add panel to left',
		action: () => addPanel('left'),
	}, {
		icon: 'ti ti-box-align-right',
		text: 'Add panel to right',
		action: () => addPanel('right'),
	});

	menuItems.push({ type: 'divider' }, {
		icon: 'ti ti-x',
		text: 'Close panel',
		danger: true,
		action: closePanel,
	});

	return menuItems;
}

function showSettingsMenu(ev: PointerEvent) {
	ui.popupMenu(getMenu(), ev.currentTarget ?? ev.target);
}

function onContextmenu(ev: PointerEvent) {
	ui.contextMenu(getMenu(), ev);
}

function goTop(ev: PointerEvent) {
	emit('headerClick', ev);
	if (!props.handleScrollToTop) return;

	if (body.value) {
		body.value.scrollTo({
			top: 0,
			behavior: 'smooth',
		});
	}
}

const dropReadyArea = ref<'top' | 'bottom' | 'left' | 'right' | 'center' | null>(null);

function onDragstart(ev: DragEvent) {
	if (ev.dataTransfer == null) return;
	ev.dataTransfer.effectAllowed = 'move';
	setDragData(ev, 'WorkspacePanel', { id: props.panel.id });

	const target = ev.target as HTMLElement;
	target.addEventListener('dragend', (ev) => {
		workspacePanelDraggingContext.draggingId.value = null;
		dropReadyArea.value = null;
	}, { once: true });

	// Chromeのバグで、Dragstartハンドラ内ですぐにDOMを変更する(=リアクティブなプロパティを変更する)とDragが終了してしまう
	// SEE: https://stackoverflow.com/questions/19639969/html5-dragend-event-firing-immediately
	// SEE: https://issues.chromium.org/issues/41150279
	window.setTimeout(() => {
		workspacePanelDraggingContext.draggingId.value = props.panel.id;
	}, 10);
}

function onDragover(ev: DragEvent, area: 'top' | 'bottom' | 'left' | 'right' | 'center') {
	nextTick(() => {
		dropReadyArea.value = area;
	});
}

function onDragleave(ev: DragEvent) {
	dropReadyArea.value = null;
}

function onDrop(ev: DragEvent, area: 'top' | 'bottom' | 'left' | 'right' | 'center') {
	dropReadyArea.value = null;
	const draggingId = workspacePanelDraggingContext.draggingId.value;
	workspacePanelDraggingContext.draggingId.value = null;
	if (draggingId == null || draggingId === props.panel.id) return;

	const workspace = deepClone(preferences.s.workspaceDefinition);
	const sourceParent = findWorkspaceParent(workspace, draggingId);
	const targetParent = findWorkspaceParent(workspace, props.panel.id);
	if (!sourceParent || !targetParent) return;

	const sourceIndex = sourceParent.children.findIndex(child => child.id === draggingId);
	const panel = sourceParent.children[sourceIndex];
	if (panel.type === null) return;

	const targetIndex = targetParent.children.findIndex(child => child.id === props.panel.id);
	const target = targetParent.children[targetIndex];
	if (target.type === null) return;

	if (area === 'center') {
		// パネルのサイズではなく、移動先の領域のサイズを維持する。
		[panel.ratio, target.ratio] = [target.ratio, panel.ratio];
		sourceParent.children[sourceIndex] = target;
		targetParent.children[targetIndex] = panel;
	} else {
		sourceParent.children.splice(sourceIndex, 1);
		const direction = area === 'top' || area === 'bottom' ? 'vertical' : 'horizontal';
		splitWorkspacePanel(targetParent, target, panel, direction, area === 'top' || area === 'left');
	}
	preferences.commit('workspaceDefinition', cleanupWorkspaceDefinition(workspace));
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	height: 100%;
	overflow: clip;
	contain: strict;
}

.main {
	--headerHeight: 32px;

	position: relative;
	height: 100%;
	border-radius: 10px;
	overflow: clip;

	&:not(.active) {
		flex-basis: var(--headerHeight);
		min-height: var(--headerHeight);
		border-bottom-right-radius: 0;
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
	background: linear-gradient(0deg, var(--THEME-workspacePanelHeader), hsl(from var(--THEME-workspacePanelHeader) h s calc(l + 5)));
	user-select: none;
}

.color {
	position: absolute;
	top: 12px;
	left: 12px;
	width: 3px;
	height: calc(100% - 24px);
	background: var(--THEME-accent);
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
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	width: 100%;
}

.toggleActive,
.menu {
	z-index: 1;
	width: var(--headerHeight);
	line-height: var(--headerHeight);
	font-size: 90%;
}

.toggleActive {
	margin-left: -16px;
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
	opacity: 0.5;
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
	box-sizing: border-box;
	container-type: size;
	background-color: var(--THEME-workspacePanelBody);
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
