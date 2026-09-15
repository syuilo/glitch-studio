<template>
<div ref="root" :class="[$style.root, { [$style.collapsed]: collapsed }]">
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
			<button class="_button" :class="$style.tabMenu" @click="showTabMenu($event, tab)"><i class="ti ti-dots-vertical"></i></button>
		</div>
		<button class="_button" :class="$style.addTabButton" @click="addTab"><i class="ti ti-plus"></i></button>
		<button class="_button" :class="$style.menuButton" style="margin-left: auto;" @click="showMenu"><i class="ti ti-dots"></i></button>
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
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { computed, ref, watch } from 'vue';
import { genId } from '@glitch/shared/utility/id.js';
import type { MenuItem } from '@/types/menu.ts';
import type { WorkspaceTabs } from '@/workspace.ts';
import { getElementMenu, workspacePanelDefinitions } from '@/workspace.ts';
import { findWorkspaceElement, findWorkspaceParent } from '@/utility/workspace.ts';
import * as ui from '@/ui.ts';
import { preferences } from '@/preferences.ts';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';

const props = withDefaults(defineProps<{
	tabs: WorkspaceTabs;
}>(), {

});

const selectedTabId = ref(props.tabs.children.at(0)?.element.id);
const selectedTab = computed(() => props.tabs.children.find(tab => tab.element.id === selectedTabId.value));

// 保存のたびにツリーが複製されるため、選択はオブジェクトではなくIDで保持する。
// 選択中の要素が分割・削除された場合は、同じ位置（末尾なら直前）のタブを選ぶ。
watch(() => props.tabs.children.map(tab => tab.element.id), (ids, oldIds) => {
	if (selectedTabId.value != null && ids.includes(selectedTabId.value)) return;
	const index = selectedTabId.value == null ? 0 : Math.max(0, oldIds.indexOf(selectedTabId.value));
	selectedTabId.value = ids[Math.min(index, ids.length - 1)];
});

function select(tab: typeof props.tabs.children[0]) {
	selectedTabId.value = tab.element.id;
}

function addTab(ev: PointerEvent) {
	const menuItems: MenuItem[] = workspacePanelDefinitions.map(choice => ({
		text: choice.label,
		action: () => {
			const workspace = deepClone(preferences.s.workspaceDefinition);
			const tabs = findWorkspaceElement(workspace, props.tabs.id);
			if (tabs?.type !== 'tabs') return;
			const id = genId();
			tabs.children.push({ name: choice.label, element: { id, type: 'panel', contentType: choice.type } });
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
	contain: strict;

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
	padding-left: 8px;
	gap: 16px;
	box-sizing: border-box;
	height: var(--headerHeight);
}

.tab {
	position: relative;
	font-size: 90%;

	&::after {
		content: '';
		display: block;
		position: absolute;
		bottom: 4px;
		left: 0;
		width: 100%;
		height: 2px;
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
	padding: 4px 0 8px 6px;
	box-sizing: border-box;
	height: 100%;
}

.tabMenu {
	margin-left: 8px;
}

.addTabButton {
	font-size: 90%;
	padding-bottom: 4px;
}

.menuButton {
	font-size: 90%;
}

.toggleCollapse {
	font-size: 90%;
	padding-bottom: 4px;
}

.tabContent {
	flex: 1;
	min-width: 0;
	min-height: 0;
}
</style>
