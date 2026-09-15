<template>
<div ref="root" :class="[$style.root]">
	<div :class="$style.tabs">
		<div v-for="tab in props.tabs.children" :key="tab.element.id" :class="[$style.tab, { [$style.activeTab]: tab.element.id === selectedTab?.element.id }]" @contextmenu.prevent.stop="showTabMenu($event, tab)">
			<button class="_button" :class="$style.tabName" @click="select(tab)">{{ tab.name }}</button>
			<button class="_button" :class="$style.tabMenu" @click="showTabMenu($event, tab)"><i class="ti ti-dots-vertical"></i></button>
		</div>
		<button class="_button" :class="$style.addTabButton" @click="addTab"><i class="ti ti-plus"></i></button>
		<button class="_button" :class="$style.menuButton" style="margin-left: auto;" @click="showMenu"><i class="ti ti-dots"></i></button>
	</div>
	<GsWorkspaceElement
		v-if="selectedTab != null"
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
import { findWorkspaceElement } from '@/utility/workspace.ts';
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
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	contain: strict;
}

.tabs {
	display: flex;
	flex-direction: row;
	padding-left: 8px;
	gap: 16px;
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

.tabContent {
	flex: 1;
	min-width: 0;
	min-height: 0;
}
</style>
