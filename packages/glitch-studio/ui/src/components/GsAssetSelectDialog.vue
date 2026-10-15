<template>
<GsModal ref="modal" :preferType="'dialog'" @closed="emit('closed')" @esc="cancel()">
	<div ref="rootEl" :class="[$style.root]">
		<div :class="$style.header">
			<button :class="$style.headerButton" class="_button" data-testid="modal-window-close" @click="cancel()"><i class="ti ti-x"></i></button>
			<span :class="$style.title">
				{{ multiple ? 'Select Assets' : 'Select Asset' }}
				<span v-if="selected.length > 0" style="margin-left: 8px; opacity: 0.5;">({{ selected.length }})</span>
			</span>
			<div style="padding: 0 16px; place-content: center;">
				<GsButton primary small rounded :disabled="selected.length === 0" @click="ok()">Done <i class="ti ti-check"></i></GsButton>
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
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { ref, useTemplateRef } from 'vue';
import GsAssets from './GsAssets.vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import type { ProjectAsset } from '@/Project.ts';

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
