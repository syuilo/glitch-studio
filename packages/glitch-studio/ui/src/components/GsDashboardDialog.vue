<template>
<GsModal ref="modal" data-test-dashboard-file-drop animatedBg preferType="dialog" @closed="emit('closed')" @dragover="onDragover" @drop="onDrop">
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
			<button class="_textButton" style="margin-top: auto;" @click="showAbout()">About</button>
		</div>
		<div :class="$style.side">
			<GsFolder defaultOpen asSection>
				<template #icon><i class="ti ti-clock"></i></template>
				<template #label>Recent Projects</template>
				<div></div>
			</GsFolder>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { inject, useTemplateRef } from 'vue';
import GsButton from './common/GsButton.vue';
import GsModal from './common/GsModal.vue';
import GsAboutDialog from './GsAboutDialog.vue';
import GsFolder from './common/GsFolder.vue';
import { appContext, newProject, newProjectFromImageOrVideo, openProject } from '@/app.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';
import { importAssets } from '@/utility/import-assets.ts';
import * as ui from '@/ui.ts';

const version = _VERSION_;
const isElectron = __ELECTRON__;

const modal = useTemplateRef('modal');
const workspaceController = inject(workspaceControllerKey)!;
let importing = false;

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

function onDragover(event: DragEvent) {
	if (event.dataTransfer?.types.includes('Files') !== true) return;
	event.preventDefault();
	event.stopPropagation();
	event.dataTransfer.dropEffect = importing || window.document.body.hasAttribute('inert') ? 'none' : 'copy';
}

async function onDrop(event: DragEvent) {
	if (event.dataTransfer?.types.includes('Files') !== true) return;
	event.preventDefault();
	event.stopPropagation();
	if (importing || window.document.body.hasAttribute('inert')) return;
	const files = Array.from(event.dataTransfer.files);
	if (files.length === 0) return;
	importing = true;
	try {
		let opened = false;
		if (files.length === 1 && files[0].name.toLowerCase().endsWith('.gsproj')) {
			// ハンドル取得はdrop中に開始する。取得失敗時もFileからプロジェクトを開ける。
			const item = Array.from(event.dataTransfer.items).find(item => item.kind === 'file');
			const handle = await item?.getAsFileSystemHandle?.().catch(() => null);
			opened = await openProject(files[0], handle?.kind === 'file' ? handle as FileSystemFileHandle : null);
		} else if (files.length === 1 && /^(image|video|audio)\//.test(files[0].type)) {
			// ファイル選択ボタンと同じ入口を使い、素材に対応したノード・レイヤー・解像度を設定する。
			opened = await newProjectFromImageOrVideo(files[0]);
		} else {
			const ids = await importAssets(appContext.projectContext, files, async () => {
				if (!appContext.projectContext.hasProject) await newProject();
			});
			opened = ids.length > 0;
			if (opened) workspaceController.revealPanel({ contentType: 'assets', sourcePanelId: null });
		}
		if (opened) modal.value!.close();
	} catch (error) {
		await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	} finally {
		importing = false;
	}
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

.side {
	flex: 1;
}
</style>
