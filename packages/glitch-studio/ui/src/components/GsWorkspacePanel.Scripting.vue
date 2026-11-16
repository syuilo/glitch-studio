<template>
<div :class="$style.root" data-test-scripting-panel>
	<div :class="$style.toolbar">
		<GsButton
			v-tooltip="i18n.ts._Scripting.RunShortcut"
			data-test-scripting-run
			primary
			icon="ti ti-player-play"
			:wait="scripting.isRunning.value"
			:disabled="scripting.source.value.trim().length === 0"
			@click="run"
		>
			{{ scripting.isRunning.value ? i18n.ts._Scripting.Running : i18n.ts._Scripting.Run }}
		</GsButton>
		<span :class="$style.hint">{{ i18n.ts._Scripting.TemporarySource }}</span>
	</div>
	<div :class="$style.editor">
		<GsTextarea
			v-model="scripting.source.value"
			data-test-scripting-source
			code
			tall
			pre
			:spellcheck="false"
			@keydown="onEditorKeydown"
		>
			<template #label>AiScript</template>
		</GsTextarea>
	</div>
	<div :class="$style.outputSection">
		<div :class="$style.outputToolbar">
			<span>{{ i18n.ts._Scripting.Output }}</span>
			<GsButton
				data-test-scripting-clear-output
				small
				icon="ti ti-trash"
				:disabled="scripting.output.value.length === 0"
				@click="scripting.clearOutput()"
			>
				{{ i18n.ts._Scripting.ClearOutput }}
			</GsButton>
		</div>
		<div ref="outputElement" class="_selectable _monospace" :class="$style.output" data-test-scripting-output>
			<div v-if="scripting.output.value.length === 0" :class="$style.hint">{{ i18n.ts._Scripting.EmptyOutput }}</div>
			<div v-for="(entry, index) in scripting.output.value" :key="index" :class="$style.outputEntry">{{ entry }}</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { nextTick, useTemplateRef, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import GsTextarea from './common/GsTextarea.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';

defineProps<{ panel: WorkspacePanel }>();

const { scripting } = useProjectSession();
const outputElement = useTemplateRef<HTMLDivElement>('outputElement');

function run(): void {
	if (scripting.isRunning.value || scripting.source.value.trim().length === 0) return;
	void scripting.run();
}

function onEditorKeydown(event: KeyboardEvent): void {
	if (event.isComposing || event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
	event.preventDefault();
	event.stopPropagation();
	if (!event.repeat) run();
}

watch(() => scripting.output.value, async () => {
	// 既存の出力を読んでいる間はスクロール位置を維持し、末尾表示中だけ追従する。
	const element = outputElement.value;
	if (element == null) return;
	const followOutput = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
	await nextTick();
	if (followOutput) element.scrollTop = element.scrollHeight;
});
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	overflow: clip;
}

.toolbar {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
	padding: 8px;
}

.hint {
	font-size: 90%;
	opacity: 0.65;
}

.editor {
	flex: 2 1 0;
	min-height: 0;
	padding: 0 8px 8px;
	overflow: auto;
}

.outputSection {
	display: flex;
	flex-direction: column;
	flex: 1 1 0;
	min-height: 80px;
	border-top: solid 1px var(--THEME-divider);
}

.outputToolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 8px;
}

.output {
	flex: 1;
	min-height: 0;
	padding: 0 8px 8px;
	overflow: auto;
	tab-size: 4;
}

.outputEntry {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	padding: 2px 0;
}
</style>
