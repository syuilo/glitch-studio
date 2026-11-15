<template>
<div :class="$style.root" data-test-scripting>
	<div :class="$style.toolbar">
		<GsButton
			data-test-script-run
			primary
			icon="ti ti-player-play"
			:disabled="scripting.isRunning.value"
			@click="scripting.run()"
		>{{ i18n.ts._Scripting.Run }}</GsButton>
		<span data-test-script-status>{{ statusLabel }}</span>
	</div>
	<textarea
		v-model="scripting.source.value"
		data-test-script-source
		:class="[$style.editor, '_monospace', '_selectable']"
		:spellcheck="false"
		@keydown="onKeydown"
	></textarea>
	<div :class="$style.toolbar">
		<span>{{ i18n.ts._Scripting.Output }}</span>
		<GsButton data-test-script-clear small @click="scripting.clearOutput()">{{ i18n.ts._Scripting.ClearOutput }}</GsButton>
	</div>
	<div ref="outputElement" :class="[$style.output, '_monospace', '_selectable']" data-test-script-output>
		<div
			v-for="(entry, index) in scripting.output.value"
			:key="index"
			:class="[$style.entry, { [$style.error]: entry.kind === 'error' }]"
		>{{ entry.kind === 'truncated' ? i18n.ts._Scripting.OutputTruncated : entry.text }}</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, useTemplateRef, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import type { WorkspacePanel } from '@/workspace.ts';

defineProps<{ panel: WorkspacePanel }>();
const { scripting } = useProjectSession();
const outputElement = useTemplateRef('outputElement');
const statusLabel = computed(() => ({
	idle: i18n.ts._Scripting.Idle,
	running: i18n.ts._Scripting.Running,
	succeeded: i18n.ts._Scripting.Succeeded,
	exited: i18n.ts._Scripting.Exited,
	failed: i18n.ts._Scripting.Failed,
})[scripting.status.value]);

watch(scripting.output, () => {
	const element = outputElement.value;
	if (element != null) element.scrollTop = element.scrollHeight;
}, { flush: 'post' });

function onKeydown(event: KeyboardEvent) {
	if (event.isComposing) return;
	if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
		event.preventDefault();
		event.stopPropagation();
		if (!event.repeat && !scripting.isRunning.value) void scripting.run();
	} else if (event.key === 'Tab') {
		event.preventDefault();
		const element = event.target as HTMLTextAreaElement;
		const start = element.selectionStart;
		const end = element.selectionEnd;
		scripting.source.value = scripting.source.value.slice(0, start) + '\t' + scripting.source.value.slice(end);
		nextTick(() => element.setSelectionRange(start + 1, start + 1));
	}
}
</script>

<style module lang="scss">
.root {
	display: grid;
	grid-template-rows: auto minmax(80px, 1fr) auto minmax(60px, 1fr);
	height: 100%;
	min-width: 0;
}

.toolbar {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px;
}

.editor {
	box-sizing: border-box;
	width: 100%;
	height: 100%;
	padding: 12px;
	resize: none;
	border: 1px solid var(--THEME-divider);
	background: var(--THEME-panel);
	color: inherit;
	outline: none;
	line-height: 1.6;
	tab-size: 2;
	white-space: pre;
	overflow: auto;
}

.output {
	padding: 8px 12px;
	border-top: 1px solid var(--THEME-divider);
	overflow: auto;
}

.entry {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	padding-bottom: 4px;
}

.error {
	color: var(--THEME-error);
}
</style>
