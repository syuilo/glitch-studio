<template>
<GsModal ref="modal" data-test-dashboard-file-drop animatedBg preferType="dialog" @closed="emit('closed')">
	<div :class="$style.root">
		<div :class="$style.main" class="_gaps_l">
			<div style="display: flex; align-items: center; gap: 16px; font-size: 110%;">
				<img src="/gs.svg" draggable="false" style="display: block; width: 55px; height: 55px;">
				<div>
					<div><b>Glitch Studio{{ isElectron ? '' : ' (for Web)' }}</b></div>
					<div>{{ version }}</div>
				</div>
			</div>
			<div>
				<div v-if="!isElectron">{{ i18n.ts._Dashboard.WebLimitations }}<a class="_gs-link" href="https://syuilo.dev/glitch-studio/docs/guide/download" target="_blank">{{ i18n.ts._Dashboard.DesktopVersion }}</a></div>
			</div>
			<div class="_gaps_m">
				<GsButton full style="text-align: left;" @click="_newProject"><i class="ti ti-plus" style="margin-right: 1em;"></i>{{ i18n.ts._Dashboard.NewProject }}</GsButton>
				<GsButton full style="text-align: left;" @click="_newProjectFromImageOrVideo"><i class="ti ti-photo-video" style="margin-right: 1em;"></i>{{ i18n.ts._Dashboard.OpenMedia }}</GsButton>
				<GsButton full style="text-align: left;" @click="_openProject"><i class="ti ti-folder-open" style="margin-right: 1em;"></i>{{ i18n.ts._Dashboard.OpenProject }}</GsButton>
			</div>
			<button class="_textButton" style="margin-top: auto;" @click="showAbout()">{{ i18n.ts._App.About }}</button>
		</div>
		<div :class="$style.side">
			<GsFolder defaultOpen asSection>
				<template #icon><i class="ti ti-clock"></i></template>
				<template #label>{{ i18n.ts._Dashboard.RecentProjects }}</template>
				<div :class="$style.recentProjects" data-test-recent-projects>
					<div v-if="recentProjects.error.value != null" :class="$style.recentError" data-test-recent-projects-error>
						{{ recentProjects.error.value }}
						<button class="_textButton" :disabled="recentProjectsBusy" @click="refreshRecentProjects">{{ i18n.ts._Dashboard.RetryRecentProjects }}</button>
					</div>
					<div v-if="recentProjectsLoading" data-test-recent-projects-loading>{{ i18n.ts.Loading }}</div>
					<template v-else>
						<div v-if="recentProjects.entries.value.length === 0 && recentProjects.error.value == null" :class="$style.recentEmpty" data-test-recent-projects-empty>{{ i18n.ts._Dashboard.NoRecentProjects }}</div>
						<div v-for="entry in recentProjects.entries.value" :key="entry.id" :class="$style.recentProject" data-test-recent-project>
							<button class="_button" :class="$style.recentOpen" :disabled="recentProjectsBusy" data-test-open-recent-project @click="openRecentProject(entry.id)">
								<span :class="$style.recentName">{{ entry.name }}</span>
								<span :class="$style.recentFileName">{{ entry.fileName }}</span>
								<GsTime :key="entry.lastUsedAt" :time="entry.lastUsedAt" :class="$style.recentTime" data-test-recent-project-time/>
							</button>
							<button v-tooltip="i18n.ts._Dashboard.RemoveRecentProject" class="_button" :class="$style.recentRemove" :disabled="recentProjectsBusy" data-test-remove-recent-project @click="removeRecentProject(entry.id)"><i class="ti ti-x"></i></button>
						</div>
						<button v-if="recentProjects.entries.value.length > 0" class="_textButton" :disabled="recentProjectsBusy" data-test-clear-recent-projects @click="clearRecentProjects">{{ i18n.ts._Dashboard.ClearRecentProjects }}</button>
					</template>
				</div>
			</GsFolder>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { inject, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import GsButton from './common/GsButton.vue';
import GsModal from './common/GsModal.vue';
import GsAboutDialog from './GsAboutDialog.vue';
import GsFolder from './common/GsFolder.vue';
import GsTime from './common/GsTime.vue';
import { i18n } from '@/i18n.ts';
import { recentProjects } from '@/recent-projects.ts';
import { appContext, newProject, newProjectFromImageOrVideo, openProject } from '@/app.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';
import { importAssets } from '@/utility/import-assets.ts';
import { installFileDropHandlers } from '@/utility/file-drop.ts';
import * as ui from '@/ui.ts';

const version = _VERSION_;
const isElectron = __ELECTRON__;

const modal = useTemplateRef('modal');
const workspaceController = inject(workspaceControllerKey)!;
let disposeFileDrops: (() => void) | null = null;
const recentProjectsLoading = ref(true);
const recentProjectsBusy = ref(false);

async function refreshRecentProjects() {
	recentProjectsLoading.value = true;
	await recentProjects.refresh();
	recentProjectsLoading.value = false;
}

async function openRecentProject(id: string) {
	if (recentProjectsBusy.value) return;
	recentProjectsBusy.value = true;
	try {
		const handle = await recentProjects.resolve(id);
		if (await openProject(null, handle)) modal.value?.close();
	} catch (error) {
		await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	} finally {
		recentProjectsBusy.value = false;
	}
}

async function removeRecentProject(id: string) {
	recentProjectsBusy.value = true;
	await recentProjects.remove(id);
	recentProjectsBusy.value = false;
}

async function clearRecentProjects() {
	recentProjectsBusy.value = true;
	const { canceled } = await ui.confirm({ type: 'question', text: i18n.ts._Dashboard.ConfirmClearRecentProjects });
	if (!canceled) await recentProjects.clear();
	recentProjectsBusy.value = false;
}

onMounted(() => {
	void refreshRecentProjects();
	const target = modal.value?.getRootElement();
	if (target == null) return;
	disposeFileDrops = installFileDropHandlers(target, onFileDrop,
		error => { void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) }); },
		() => window.document.body.hasAttribute('inert'));
});
onBeforeUnmount(() => { disposeFileDrops?.(); });

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

async function onFileDrop(files: File[], event: DragEvent) {
	let opened = false;
	if (files.length === 1 && files[0].name.toLowerCase().endsWith('.gsproj')) {
		// ユーティリティからdrop中に呼び出される。await前にハンドル取得を開始し、
		// 取得失敗時もスナップショット済みのFileからプロジェクトを開ける。
		const item = Array.from(event.dataTransfer?.items ?? []).find(item => item.kind === 'file');
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
	overflow: clip;
}

.main {
	padding: 32px;
	border-right: solid 1px #fff1;
}

.side {
	flex: 1;
	min-width: 0;
	overflow-y: auto;
}

.recentProjects {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.recentProject {
	display: flex;
	align-items: center;
	border-radius: 6px;

	&:hover, &:focus-within {
		background: var(--THEME-buttonHoverBg);
	}
}

.recentOpen {
	display: flex;
	flex: 1;
	min-width: 0;
	flex-direction: column;
	gap: 4px;
	padding: 10px;
	text-align: left;
}

.recentName, .recentFileName {
	max-width: 100%;
	overflow: clip;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.recentName {
	font-weight: bold;
}

.recentFileName, .recentTime, .recentEmpty {
	opacity: 0.7;
}

.recentRemove {
	flex-shrink: 0;
	padding: 10px;
}

.recentError {
	overflow-wrap: anywhere;
}
</style>
