<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @dragover.prevent.stop @drop.prevent.stop="onDrop">
	<div :class="$style.root">
		<div :class="$style.main" class="_gaps_l">
			<div style="display: flex; align-items: center; gap: 16px;">
				<img src="/gs.svg" style="display: block; width: 64px; height: 64px;">
				<div>
					<div><b>Glitch Studio{{ isElectron ? '' : ' (for Web)' }}</b></div>
					<div>{{ version }}</div>
				</div>
			</div>
			<div style="font-size: 90%;">
				<div v-if="!isElectron">Web版には一部制限があります。<a class="_gs-link" href="https://syuilo.dev/glitch-studio/docs/guide/download" target="_blank">デスクトップ版</a></div>
			</div>
			<div class="_gaps_m">
				<GsButton full style="text-align: left;" @click="_newProject"><i class="ti ti-plus" style="margin-right: 1em;"></i>New Project</GsButton>
				<GsButton full style="text-align: left;" @click="_newProjectFromImageOrVideo"><i class="ti ti-photo-video" style="margin-right: 1em;"></i>Open image/video/audio...</GsButton>
				<GsButton full style="text-align: left;" @click="_openProject"><i class="ti ti-folder-open" style="margin-right: 1em;"></i>Open Project...</GsButton>
			</div>
			<button class="_textButton" @click="showAbout()">About</button>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import GsButton from './common/GsButton.vue';
import GsModal from './common/GsModal.vue';
import GsAboutDialog from './GsAboutDialog.vue';
import { newProject, newProjectFromImageOrVideo, openProject } from '@/app.ts';
import * as ui from '@/ui.ts';

const version = _VERSION_;
const isElectron = __ELECTRON__;

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

function showAbout() {
	const { dispose } = ui.popup(GsAboutDialog, {}, {
		closed: () => dispose(),
	});
}
</script>

<style lang="scss" module>
.root {
	margin: auto;
	position: relative;
	width: 800px;
	max-width: 100%;
	height: 500px;
	max-height: 100%;
	box-sizing: border-box;
	display: flex;
	background: var(--THEME-dialog);
	border-radius: 10px;
}

.main {
	padding: 32px;
	border-right: solid 1px #fff1;
}
</style>
