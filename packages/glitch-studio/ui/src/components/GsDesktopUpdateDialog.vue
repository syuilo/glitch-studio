<template>
<GsModal ref="modal" preferType="dialog" zPriority="high" @opened="content?.focus()" @click="close" @esc="close" @closed="emit('closed')" @dragover.prevent.stop @drop.prevent.stop>
	<div ref="content" :class="$style.root" class="_gaps_m" role="dialog" aria-modal="true" :aria-label="i18n.ts._DesktopUpdate.Title" tabindex="-1" data-test-desktop-update-dialog @keydown.stop>
		<strong>{{ i18n.ts._DesktopUpdate.Title }}</strong>
		<div v-if="working" role="status" aria-live="polite" data-test-desktop-update-status>
			{{ state.phase === 'downloading' ? i18n.ts._DesktopUpdate.Downloading : state.phase === 'installing' ? i18n.ts._DesktopUpdate.Installing : i18n.ts._DesktopUpdate.Preparing }}
		</div>
		<template v-if="working">
			<GsProgressBar :progress="state.phase === 'downloading' && state.progress != null ? state.progress.percent / 100 : null"/>
			<div v-if="state.phase === 'downloading' && state.progress != null" class="_monospace">{{ Math.floor(state.progress.percent) }}% · {{ (state.progress.transferred / 1024 ** 2).toFixed(1) }} / {{ (state.progress.total / 1024 ** 2).toFixed(1) }} MiB</div>
			<div>{{ i18n.ts._DesktopUpdate.DoNotClose }}</div>
		</template>
		<template v-else>
			<div role="alert" data-test-desktop-update-error>{{ errorMessage }}</div>
			<div :class="$style.actions">
				<GsButton inline data-test-desktop-update-close @click="close">{{ i18n.ts.Close }}</GsButton>
				<GsButton v-if="state.version != null && state.phase !== 'restart-required'" inline primary data-test-desktop-update-retry @click="emit('retry')">{{ i18n.ts._DesktopUpdate.Retry }}</GsButton>
			</div>
		</template>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef } from 'vue';
import type { DesktopUpdateState } from '@gs/glitch-studio_shared/desktop-update.ts';
import { i18n } from '@/i18n.ts';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsProgressBar from './common/GsProgressBar.vue';

const props = defineProps<{ state: DesktopUpdateState; working: boolean; localError: string | null }>();
const emit = defineEmits<{ (event: 'closed'): void; (event: 'retry'): void }>();
const modal = useTemplateRef('modal');
const content = useTemplateRef('content');
const errorMessage = computed(() => {
	if (props.state.phase === 'restart-required') {
		return `${i18n.ts._DesktopUpdate.RestartRequiredDetails}\n${props.localError ?? props.state.error?.message ?? ''}`;
	}
	return props.localError ?? (props.state.error?.code === 'other-instances'
		? i18n.ts._DesktopUpdate.OtherInstances : `${i18n.ts._DesktopUpdate.Failed}\n${props.state.error?.message ?? ''}`);
});

function close() { if (!props.working) modal.value?.close(); }
</script>

<style lang="scss" module>
.root {
	width: min(440px, calc(100vw - 48px));
	padding: 32px;
	box-sizing: border-box;
	border-radius: 8px;
	background: var(--THEME-panel);
	white-space: pre-line;
	overflow-wrap: anywhere;
}
.actions { display: flex; justify-content: flex-end; gap: 12px; }
</style>
