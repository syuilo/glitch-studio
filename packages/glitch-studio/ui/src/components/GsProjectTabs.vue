<template>
<div :class="$style.root" data-test-project-tabs>
	<div
		v-for="session in manager.sessions.value"
		:key="session.id"
		:class="[$style.tab, { [$style.active]: session === manager.activeSession.value }]"
		:data-project-session-id="session.id"
		data-test-project-tab
	>
		<button class="_button" :class="$style.select" data-test-select-project @click="manager.select(session)">
			<span :class="$style.name">{{ session.projectContext.stateManager.state.name.value }}</span>
			<span v-if="session.hasUnsavedChanges.value" v-tooltip="i18n.ts._App.UnsavedChanges" data-test-project-tab-unsaved>*</span>
			<i v-if="session.isProjectSaving.value" class="ti ti-loader" data-test-project-tab-saving></i>
		</button>
		<button
			v-tooltip="i18n.ts._App.CloseProject"
			class="_button"
			:class="$style.close"
			:disabled="manager.fileOperations.isBusy.value"
			data-test-close-project
			@click="manager.close(session)"
		>
			<i class="ti ti-x"></i>
		</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import type { ProjectSessionManager } from '@/ProjectSessionManager.ts';
import { i18n } from '@/i18n.ts';

defineProps<{ manager: ProjectSessionManager }>();
const emit = defineEmits<{ newProject: [] }>();
</script>

<style module lang="scss">
.root {
	--verticalShift: 0px;

	position: relative;
	display: flex;
	flex-shrink: 0;
	gap: 4px;
	height: 100%;
	box-sizing: border-box;
}

.tab {
	display: flex;
	flex: 0 0 auto;
	max-width: 280px;
	color: color(from var(--THEME-fg) srgb r g b / 0.6);

	&:not(.active) {
		app-region: no-drag;
	}
}

.active {
	--tabCornerRadius: 8px;

	position: relative;
	background: var(--THEME-globalBg);
	color: var(--THEME-fg);
	border-radius: var(--tabCornerRadius) var(--tabCornerRadius) 0 0;

	// 下端の外側に逆向きの丸みを描き、タブの背景を作業領域へ滑らかにつなげる。
	// 装飾が隣のタブや追加ボタンの操作を妨げないよう、ポインター判定から除外する。
	&::before,
	&::after {
		content: '';
		position: absolute;
		bottom: 0;
		width: var(--tabCornerRadius);
		height: var(--tabCornerRadius);
		box-shadow: 0 0 0 var(--tabCornerRadius) var(--THEME-globalBg);
		clip-path: inset(0);
		pointer-events: none;
	}

	&::before {
		right: 100%;
		border-bottom-right-radius: var(--tabCornerRadius);
	}

	&::after {
		left: 100%;
		border-bottom-left-radius: var(--tabCornerRadius);
	}
}

.select {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	padding-top: var(--verticalShift);
	padding-left: 14px;
}

.name {
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
}

.close {
	padding-top: var(--verticalShift);
	height: 100%;
	box-sizing: border-box;
	aspect-ratio: 1;
	display: grid;
	place-items: center;
	font-size: 90%;
	app-region: no-drag;
}

.add {
	flex-shrink: 0;
	app-region: no-drag;
}
</style>
