<template>
<div ref="root" :class="[$style.root]">
	<div :class="$style.tabs">
		<button v-for="tab in props.tabs.children" :key="tab.element.id" class="_button" :class="[$style.tab, { [$style.activeTab]: tab.element.id === selectedTab?.element.id }]" @click="select(tab)">
			{{ tab.name }}
		</button>
		<button class="_button" :class="$style.button" @click="addTab"><i class="ti ti-plus"></i></button>
		<button class="_button" :class="$style.button" style="margin-left: auto;" @click="showMenu"><i class="ti ti-dots"></i></button>
	</div>
	<GsWorkspaceElement
		v-if="selectedTab != null"
		:element="selectedTab.element"
		:class="$style.tabContent"
	/>
</div>
</template>

<script lang="ts" setup>
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { computed, nextTick, ref, shallowRef, useTemplateRef } from 'vue';
import { genId } from '@glitch/shared/utility/id.js';
import type { MenuItem } from '@/types/menu.ts';
import type { WorkspaceTabs } from '@/workspace';
import { getElementMenu, workspacePanelChoices } from '@/workspace';
import * as ui from '@/ui.ts';
import { preferences } from '@/preferences.ts';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';

const props = withDefaults(defineProps<{
	tabs: WorkspaceTabs;
}>(), {

});

const root = useTemplateRef('root');

const selectedTab = shallowRef(props.tabs.children?.at(0));

function select(tab: typeof props.tabs.children[0]) {
	selectedTab.value = tab;
}

function addTab(ev: PointerEvent) {
	const menuItems: MenuItem[] = workspacePanelChoices.map(choice => ({
		text: choice.label,
		action: () => {
			const workspace = deepClone(preferences.s.workspaceDefinition);
			// TODO
			preferences.commit('workspaceDefinition', workspace);
		},
	}));

	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target);
}

function showMenu(ev: PointerEvent) {
	ui.popupMenu(getElementMenu(props.tabs), ev.currentTarget ?? ev.target);
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
}

.tabs {
	display: flex;
	flex-direction: row;
}

.tab {
	position: relative;
	padding: 4px 16px 4px 16px;

	&::after {
		content: '';
		display: block;
		width: 100%;
		height: 2px;
		margin-top: 4px;
	}

	&.activeTab {
		&::after {
			background-color: var(--THEME-accent);
		}
	}
}

.button {
	font-size: 90%;
}

.tabContent {
	flex: 1;
	min-width: 0;
	min-height: 0;
}
</style>
