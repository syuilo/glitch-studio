<template>
<GsModal ref="modal" data-test-asset-select-file-drop :preferType="'dialog'" @closed="emit('closed')" @esc="cancel()">
	<div data-test-asset-select-content :class="[$style.root]">
		<div :class="$style.header">
			<button :class="$style.headerButton" class="_button" data-testid="modal-window-close" @click="cancel()"><i class="ti ti-x"></i></button>
			<span :class="$style.title">
				{{ multiple ? i18n.ts._Assets.SelectMultiple : i18n.ts._Assets.Select }}
				<span v-if="selected.length > 0" style="margin-left: 8px; opacity: 0.5;">({{ selected.length }})</span>
			</span>
			<div style="padding: 0 16px; place-content: center;">
				<GsButton primary small rounded :disabled="selected.length === 0" @click="ok()">{{ i18n.ts.Done }} <i class="ti ti-check"></i></GsButton>
			</div>
		</div>
		<div :class="$style.body">
			<GsAssets
				:multiple="multiple"
				:mimeType="mimeType"
				select="asset"
				@changeSelectedAssets="onChangeSelection"
				@assetDoubleClicked="onAssetDoubleClick"
			/>
		</div>
		<GsDropOverlay v-if="fileDropHovering" data-test-asset-select-drop-overlay/>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { inject, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import GsAssets from './GsAssets.vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsDropOverlay from './common/GsDropOverlay.vue';
import type { ProjectAsset } from '@/Project.ts';
import { appContext } from '@/app.ts';
import { importAssets } from '@/utility/import-assets.ts';
import { installFileDropHandlers } from '@/utility/file-drop.ts';
import { alert } from '@/ui.ts';

const props = withDefaults(defineProps<{
	multiple: boolean;
	mimeType: string | null;
}>(), {
});

const emit = defineEmits<{
	(ev: 'done', r?: ProjectAsset[]): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const fileDropHovering = ref(false);
let disposeFileDrops: (() => void) | null = null;

onMounted(() => {
	const target = modal.value?.getRootElement();
	if (target == null) return;
	disposeFileDrops = installFileDropHandlers(target, async files => {
		// Add Assetと同じ取り込みを使い、MIMEでの絞り込み・選択の確定は一覧の操作に任せる。
		const ids = await importAssets(appContext.projectContext, files);
	}, error => { void alert({ type: 'error', text: error instanceof Error ? error.message : String(error) }); },
	() => window.document.body.hasAttribute('inert'), hovering => { fileDropHovering.value = hovering; });
});
onBeforeUnmount(() => { disposeFileDrops?.(); });

const selected = ref<ProjectAsset[]>([]);

function ok() {
	emit('done', deepClone(selected.value)); // selected.valueをそのまま渡すと純粋なオブジェクトではなくProxyが渡されてしまい、シチュエーションによってはそれによって不具合の原因になる(workerにpostMessageで渡せないなど)
	modal.value?.close();
}

function cancel() {
	emit('done');
	modal.value?.close();
}

function onChangeSelection(v: ProjectAsset[]) {
	selected.value = v;
}

function onAssetDoubleClick(asset: ProjectAsset) {
	if (props.multiple) return;
	// 選択変更のwatchによる通知を待たず、ダブルクリックされたAssetそのものを確定する。
	selected.value = [asset];
	ok();
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	margin: auto;
	overflow: clip;
	display: flex;
	flex-direction: column;
	contain: content;
	width: 800px;
	height: 500px;
	border-radius: 8px;
	--headerHeight: 46px;
}

.header {
	display: flex;
	flex-shrink: 0;
	background: var(--THEME-panel);
	-webkit-backdrop-filter: blur(15px);
	backdrop-filter: blur(15px);
}

.headerButton {
	height: var(--headerHeight);
	width: var(--headerHeight);
}

.title {
	flex: 1;
	line-height: var(--headerHeight);
	padding-left: 32px;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	pointer-events: none;
}

.headerButton + .title {
	padding-left: 0;
}

.body {
	flex: 1;
	overflow: auto;
	background: var(--THEME-bg);
	container-type: size;
}
</style>
