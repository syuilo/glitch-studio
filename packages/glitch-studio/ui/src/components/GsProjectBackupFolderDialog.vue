<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')">
	<div class="_gaps_m" :class="$style.root" @keydown.stop>
		<b>{{ i18n.ts._ProjectBackups.Allow }}</b>
		<div>{{ i18n.tsx._ProjectBackups.SelectFolderDescription({ name: handle.name }) }}</div>
		<div v-if="error">{{ error }}</div>
		<GsButton large :disabled="busy" @click="chooseFolder">{{ i18n.ts._ProjectBackups.ChooseFolder }}</GsButton>
		<GsButton large :disabled="busy" @click="modal?.close()">{{ i18n.ts.Cancel }}</GsButton>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import { i18n } from '@/i18n.ts';
import { selectProjectBackupFolder } from '@/project-backup-directory.ts';

const props = defineProps<{ handle: FileSystemFileHandle }>();
const emit = defineEmits<{
	(ev: 'selected', directory: FileSystemDirectoryHandle): void;
	(ev: 'closed'): void;
}>();
const modal = useTemplateRef('modal');
const busy = ref(false);
const error = ref<string | null>(null);

async function chooseFolder() {
	busy.value = true;
	error.value = null;
	try {
		const directory = await selectProjectBackupFolder(props.handle);
		emit('selected', directory);
		modal.value?.close();
	} catch (cause) {
		if (!(cause instanceof DOMException && cause.name === 'AbortError')) error.value = cause instanceof Error ? cause.message : String(cause);
	} finally {
		busy.value = false;
	}
}
</script>

<style module lang="scss">
.root {
	width: min(480px, 90vw);
	padding: 24px;
	box-sizing: border-box;
	background: var(--THEME-panel);
	border-radius: 12px;
}
</style>
