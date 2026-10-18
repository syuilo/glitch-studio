<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="dismiss" @click="dismiss">
	<div :class="$style.root" class="_gaps_m" @keydown.stop @keydown.esc.prevent="dismiss">
		<div :class="$style.title">{{ i18n.ts._Project.SaveAs }}</div>
		<GsInput v-model="fileName" large autofocus :disabled="busy" @keydown.enter.prevent="selectFile">
			<template #label>{{ i18n.ts._Project.FileName }}</template>
		</GsInput>
		<div :class="$style.folder">{{ directory?.name ?? i18n.ts._Project.NoFolder }}</div>
		<GsButton large :disabled="busy" icon="ti ti-folder" @click="chooseFolder">{{ i18n.ts._Project.ChooseFolder }}</GsButton>
		<div v-if="error" role="alert">{{ error }}</div>
		<div :class="$style.actions">
			<GsButton large inline :disabled="busy" @click="dismiss">{{ i18n.ts.Cancel }}</GsButton>
			<GsButton large inline primary :disabled="!directory || !fileName?.trim() || busy" :wait="busy" @click="selectFile">{{ i18n.ts.Save }}</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { ref, shallowRef, useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import { getProjectFileName, getProjectSaveFileHandle } from '@/gsproj.ts';
import { confirm } from '@/ui.ts';

const props = defineProps<{ name: string }>();
const emit = defineEmits<{
	(ev: 'selected', handle: FileSystemFileHandle, directory: FileSystemDirectoryHandle): void;
	(ev: 'closed'): void;
}>();
const modal = useTemplateRef('modal');
const fileName = ref<string | null>(getProjectFileName(props.name));
const directory = shallowRef<FileSystemDirectoryHandle | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

function dismiss() {
	if (!busy.value) modal.value?.close();
}

async function chooseFolder() {
	if (busy.value) return;
	busy.value = true;
	error.value = null;
	try {
		// 非同期の保存準備からではなく、このクリックから直接呼び、ユーザー操作の権限を確保する。
		directory.value = await window.showDirectoryPicker({ id: 'glitch-studio-project', mode: 'readwrite' });
	} catch (cause) {
		if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
			error.value = cause instanceof Error ? cause.message : String(cause);
		}
	} finally {
		busy.value = false;
	}
}

async function selectFile() {
	if (!directory.value || busy.value || !fileName.value?.trim()) return;
	busy.value = true;
	error.value = null;
	try {
		const handle = await getProjectSaveFileHandle(directory.value, fileName.value, async name => {
			const result = await confirm({ type: 'question', title: i18n.ts._Project.ReplaceExisting, text: `"${name}" already exists in this folder.`, okText: i18n.ts.Replace });
			return !result.canceled;
		});
		if (handle == null) return;
		emit('selected', handle, directory.value);
		modal.value?.close();
	} catch (cause) {
		error.value = cause instanceof Error ? cause.message : String(cause);
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

.title {
	font-weight: bold;
}

.folder {
	overflow-wrap: anywhere;
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
</style>
