<template>
<GsFolder defaultOpen data-test-mcp-settings>
	<template #label>{{ i18n.ts._McpServer.Title }}</template>
	<div class="_gaps_l">
		<div :class="$style.caption">{{ i18n.ts._McpServer.Description }}</div>
		<div v-if="state == null && error == null">{{ i18n.ts.Loading }}</div>
		<template v-if="state != null">
			<GsSwitch
				:modelValue="state.settings.enabled" :disabled="busy" data-test-mcp-enabled
				@update:modelValue="controller?.update({ enabled: $event })"
			>
				{{ i18n.ts._McpServer.Enabled }}
				<template #caption>{{ i18n.ts._McpServer.EnabledHint }}</template>
			</GsSwitch>
			<div :class="$style.status" data-test-mcp-status>
				<i :class="['ti', state.status === 'running' ? 'ti-circle-check' : state.status === 'error' ? 'ti-alert-circle' : 'ti-circle']"></i>
				{{ statusLabel }}
			</div>
			<div v-if="state.error != null" :class="$style.error" class="_selectable" data-test-mcp-server-error>{{ state.error }}</div>
			<GsInput
				:modelValue="state.settings.port" type="number" manualSave large :allowExpression="false"
				:stepperImmediateUpdate="false" :min="1024" :max="65535" :step="1" :disabled="busy" data-test-mcp-port
				@update:modelValue="controller?.update({ port: $event })"
			>
				<template #label>{{ i18n.ts._McpServer.Port }}</template>
				<template #caption>{{ i18n.ts._McpServer.PortHint }}</template>
			</GsInput>
			<GsSwitch
				:modelValue="state.settings.allowEditing" :disabled="busy" data-test-mcp-allow-editing
				@update:modelValue="controller?.update({ allowEditing: $event })"
			>
				{{ i18n.ts._McpServer.AllowEditing }}
				<template #caption>{{ i18n.ts._McpServer.AllowEditingHint }}</template>
			</GsSwitch>
			<div class="_gaps_m">
				<GsInput :modelValue="state.url" readonly monospace large data-test-mcp-url>
					<template #label>{{ i18n.ts._McpServer.Url }}</template>
				</GsInput>
				<GsButton icon="ti ti-copy" :disabled="busy" data-test-mcp-copy-url @click="copy(state.url)">{{ i18n.ts._McpServer.CopyUrl }}</GsButton>
				<GsInput :modelValue="state.token" type="password" readonly monospace large data-test-mcp-token>
					<template #label>{{ i18n.ts._McpServer.Token }}</template>
				</GsInput>
				<div :class="$style.actions">
					<GsButton icon="ti ti-copy" :disabled="busy" data-test-mcp-copy-token @click="copy(state.token)">{{ i18n.ts._McpServer.CopyToken }}</GsButton>
					<GsButton icon="ti ti-refresh" :disabled="busy" data-test-mcp-regenerate-token @click="controller?.regenerateToken()">{{ i18n.ts._McpServer.RegenerateToken }}</GsButton>
				</div>
				<div :class="$style.caption">{{ i18n.ts._McpServer.TokenHint }}</div>
			</div>
			<div class="_gaps_m">
				<div>{{ i18n.ts._McpServer.ClientConfiguration }}</div>
				<div :class="$style.actions">
					<GsButton icon="ti ti-copy" :disabled="busy" data-test-mcp-copy-codex @click="copyConfiguration('codex')">{{ i18n.ts._McpServer.CopyCodexConfiguration }}</GsButton>
					<GsButton icon="ti ti-copy" :disabled="busy" data-test-mcp-copy-claude @click="copyConfiguration('claude')">{{ i18n.ts._McpServer.CopyClaudeConfiguration }}</GsButton>
				</div>
				<div :class="$style.caption">{{ i18n.ts._McpServer.ClientConfigurationHint }}</div>
				<div v-if="copied" data-test-mcp-copied>{{ i18n.ts._McpServer.Copied }}</div>
			</div>
			<div class="_gaps_m">
				<div>{{ i18n.ts._McpServer.Activity }}</div>
				<div v-if="state.activity.length === 0" :class="$style.caption">{{ i18n.ts._McpServer.NoActivity }}</div>
				<div v-else :class="$style.activity" data-test-mcp-activity>
					<div v-for="entry in state.activity" :key="entry.id" :class="$style.activityEntry">
						<div :class="$style.activityHeader">
							<span class="_monospace">{{ entry.tool }}</span>
							<GsTime :time="entry.startedAt"/>
						</div>
						<div :class="{ [$style.error]: entry.error != null }" class="_selectable">
							{{ entry.error ?? (entry.finishedAt == null ? i18n.ts._McpServer.OperationRunning : i18n.ts._McpServer.OperationCompleted) }}
						</div>
					</div>
				</div>
			</div>
		</template>
		<div v-if="error != null" :class="$style.error" class="_selectable" data-test-mcp-settings-error>{{ error }}</div>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import GsFolder from './common/GsFolder.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import GsTime from './common/GsTime.vue';
import { DesktopMcpSettings, createMcpClientConfiguration } from '@/desktop-mcp-settings.ts';
import { clipboardText } from '@/utility/clipboard-text.ts';
import { i18n } from '@/i18n.ts';

const controller = window.desktop == null ? null : new DesktopMcpSettings(window.desktop);
const state = computed(() => controller?.state.value ?? null);
const busy = computed(() => controller?.busy.value ?? false);
const copyError = ref<string | null>(null);
const copied = ref(false);
const error = computed(() => controller?.error.value ?? copyError.value);
const statusLabel = computed(() => {
	const labels = {
		stopped: i18n.ts._McpServer.Stopped,
		starting: i18n.ts._McpServer.Starting,
		running: i18n.ts._McpServer.Running,
		error: i18n.ts._McpServer.Failed,
	};
	return state.value == null ? '' : labels[state.value.status];
});

async function copy(value: string): Promise<void> {
	copyError.value = null;
	copied.value = false;
	try {
		await clipboardText.writeText(value);
		copied.value = true;
	} catch (error) {
		copyError.value = error instanceof Error ? error.message : String(error);
	}
}

async function copyConfiguration(client: 'codex' | 'claude'): Promise<void> {
	if (state.value != null) await copy(createMcpClientConfiguration(client, state.value));
}

onMounted(() => { void controller?.connect(); });
onUnmounted(() => controller?.dispose());
</script>

<style module lang="scss">
.caption {
	font-size: 90%;
	opacity: 0.7;
}

.status {
	display: flex;
	align-items: center;
	gap: 8px;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.error {
	color: var(--THEME-error);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.activity {
	max-height: 240px;
	overflow: auto;
}

.activityEntry {
	padding: 8px 0;
	border-bottom: solid 1px var(--THEME-divider);
}

.activityHeader {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 4px;
	font-size: 90%;
}
</style>
