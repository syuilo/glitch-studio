<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @dragover.prevent.stop @drop.prevent.stop="onDrop">
	<div :class="$style.root" class="_gaps_s">
		<div>
			<div><b>Glitch Studio</b></div>
			<div>{{ version }}</div>
		</div>
		<div>
			<GsButton inline @click="_newProject">New project</GsButton>
		</div>
		<div>
			<GsButton inline @click="_newProjectFromImageOrVideo">New project from image/video/audio</GsButton>
		</div>
		<div>
			<GsButton inline @click="_openProject">Open project</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import GsButton from './common/GsButton.vue';
import GsModal from './common/GsModal.vue';
import { newProject, newProjectFromImageOrVideo, openProject } from '@/app.ts';

const version = _VERSION_;

const modal = useTemplateRef('modal');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

async function _newProject() {
	await newProject();
	modal.value!.close();
}

async function _newProjectFromImageOrVideo() {
	const opened = await newProjectFromImageOrVideo();
	if (opened) {
		modal.value!.close();
	}
}

async function onDrop(event: DragEvent) {
	const file = event.dataTransfer?.files[0];
	if (file == null) return;
	// DataTransferItemはdropイベント中に取得し、非同期読み込み後にも保存先を保持する。
	const item = Array.from(event.dataTransfer!.items).find(item => item.kind === 'file');
	const handle = file.name.toLowerCase().endsWith('.gsproj') ? await item?.getAsFileSystemHandle?.().catch(() => null) : null;
	const opened = file.name.toLowerCase().endsWith('.gsproj')
		? await openProject(file, handle?.kind === 'file' ? handle as FileSystemFileHandle : undefined)
		: await newProjectFromImageOrVideo(file);
	if (opened) modal.value!.close();
}

async function _openProject() {
	if (await openProject()) modal.value!.close();
}
</script>

<style lang="scss" module>
.root {
	margin: auto;
	position: relative;
	padding: 32px;
	min-width: 320px;
	max-width: 480px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-dialog);
	border-radius: 10px;
}
</style>
