<template>
<div ref="root" :class="[$style.root, { [$style.collapsed]: collapsed, [$style.vertical]: vertical }]">
	<div :class="$style.tabs">
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
		<div v-for="tab in props.tabs.children" :key="tab.element.id" :class="[$style.tab, { [$style.activeTab]: tab.element.id === selectedTab?.element.id }]" @contextmenu.prevent.stop="showTabMenu($event, tab)">
			<button class="_button" :class="$style.tabName" @click="select(tab)">{{ tab.name }}</button>
			<button class="_button" :class="$style.tabMenu" @click="showTabMenu($event, tab)"><i v-if="vertical" class="ti ti-dots"></i><i v-else class="ti ti-dots-vertical"></i></button>
		</div>
		<button class="_button" :class="$style.addTabButton" @click="addTab"><i class="ti ti-plus"></i></button>
		<button class="_button" :class="$style.menuButton" @click="showMenu"><i class="ti ti-dots"></i></button>
	</div>
	<GsWorkspaceElement
		v-if="selectedTab != null && !collapsed"
		:key="selectedTab.element.id"
		:element="selectedTab.element"
		:class="$style.tabContent"
	/>
</div>
</template>

<script lang="ts" setup>
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { computed, inject } from 'vue';
import { genId } from '@gs/shared/utility/id.js';
import type { MenuItem } from '@/types/menu.ts';
import type { WorkspaceTabs } from '@/workspace.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';
import { getElementMenu, workspacePanelChoices } from '@/workspace.ts';
import { findWorkspaceElement, findWorkspaceParent } from '@/utility/workspace.ts';
import * as ui from '@/ui.ts';
import { preferences } from '@/preferences.ts';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';

const props = withDefaults(defineProps<{
	tabs: WorkspaceTabs;
}>(), {

});

const workspaceController = inject(workspaceControllerKey)!;
const selectedTabId = computed({
	get: () => workspaceController.getSelectedTabId(props.tabs),
	set: id => { if (id != null) workspaceController.selectTab(props.tabs.id, id); },
});
const selectedTab = computed(() => props.tabs.children.find(tab => tab.element.id === selectedTabId.value));

function select(tab: typeof props.tabs.children[0]) {
	selectedTabId.value = tab.element.id;
}

function addTab(ev: PointerEvent) {
	const menuItems: MenuItem[] = workspacePanelChoices.map(({ type, ...info }) => ({
		text: info.label,
		action: () => {
			const workspace = deepClone(preferences.s.workspaceDefinition);
			const tabs = findWorkspaceElement(workspace, props.tabs.id);
			if (tabs?.type !== 'tabs') return;
			const id = genId();
			tabs.children.push({ name: info.label, element: { id, type: 'panel', direction: 'horizontal', contentType: type } });
			preferences.commit('workspaceDefinition', workspace);
			selectedTabId.value = id;
		},
	}));

	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target);
}

function showMenu(ev: PointerEvent) {
	ui.popupMenu(getElementMenu(props.tabs), ev.currentTarget ?? ev.target);
}

function showTabMenu(ev: PointerEvent, tab: WorkspaceTabs['children'][number]) {
	ui.contextMenu(getElementMenu(tab.element), ev);
}

const parent = computed(() => findWorkspaceParent(preferences.r.workspaceDefinition.value, props.tabs.id));
const canCollapse = computed(() => parent.value?.type === 'divider');
const stackingDirection = computed(() => parent.value?.type === 'divider' ? parent.value.direction : 'vertical');
const collapsed = computed(() => canCollapse.value && props.tabs.collapsed === true);
// 折りたたみ中は親の分割方向に合わせ、細くなった領域にもタブ列を収める。
const vertical = computed(() => collapsed.value ? stackingDirection.value === 'horizontal' : props.tabs.direction === 'vertical');

function toggleCollapse() {
	const workspace = deepClone(preferences.s.workspaceDefinition);
	const el = findWorkspaceElement(workspace, props.tabs.id);
	if (!el || el.type !== 'tabs') return;
	el.collapsed = !el.collapsed;
	preferences.commit('workspaceDefinition', workspace);
}
</script>

<style module lang="scss">
.root {
	--headerHeight: 32px;

	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;

	&.collapsed {
		flex-grow: 0 !important;
		flex-shrink: 0;
		flex-basis: var(--headerHeight);
		min-height: var(--headerHeight);
	}
}

.tabs {
	display: flex;
	flex-direction: row;
	flex-shrink: 0;
	padding-left: 8px;
	gap: 16px;
	box-sizing: border-box;
	height: var(--headerHeight);
	border-bottom: solid 3px #111;
	margin-bottom: 5px;
}

.tab {
	position: relative;
	font-size: 90%;

	&::after {
		content: '';
		display: block;
		position: absolute;
		bottom: -3px;
		left: 0;
		width: 100%;
		height: 3px;
		pointer-events: none;
	}

	&.activeTab {
		&::after {
			background-color: var(--THEME-accent);
		}
	}

	&:not(.activeTab) {
		.tabMenu {
			pointer-events: none;
			opacity: 0.5;
		}
	}
}

.tabName {
	padding: 4px 0 4px 6px;
	box-sizing: border-box;
	height: 100%;
}

.tabMenu {
	margin-left: 8px;
}

.addTabButton {
	font-size: 90%;
}

.menuButton {
	font-size: 90%;
	margin-left: auto;
}

.toggleCollapse {
	font-size: 90%;
}

.tabContent {
	flex: 1;
	min-width: 0;
	min-height: 0;
}

.vertical {
	flex-direction: row;

	> .tabs {
		flex-direction: column;
		width: var(--headerHeight);
		height: auto;
		padding: 8px 0 0;
		border-bottom: 0;
		border-right: solid 3px #111;
		margin: 0 5px 0 0;

		> .tab {
			display: flex;
			flex-direction: column;
			align-items: center;
			flex-shrink: 0;

			&::after {
				bottom: auto;
				left: auto;
				top: 0;
				right: -3px;
				width: 3px;
				height: 100%;
			}

			> .tabName {
				writing-mode: sideways-lr;
				width: 100%;
				height: auto;
				padding: 6px 4px 0;
			}

			> .tabMenu {
				margin: 8px 0 0;
			}
		}

		> .menuButton {
			margin: auto 0 0;
		}
	}
}
</style>
