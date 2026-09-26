<template>
<div :class="$style.root">
	<div :class="$style.header">{{ asset.name }}</div>
	<div :class="$style.buttons">
		<GsButton :class="$style.button" :vTooltip="i18n.ts.ReplaceAsset" @click="replace()"><i class="ti ti-refresh"></i></GsButton>
		<GsButton :class="$style.button" :vTooltip="i18n.ts.RenameAsset" @click="rename()"><i class="ti ti-cursor-text"></i></GsButton>
		<GsButton :class="$style.button" :vTooltip="i18n.ts.RemoveAsset" @click="remove()"><i class="ti ti-trash"></i></GsButton>
	</div>
	<div :class="$style.body">
		<img v-if="imageUrl" :src="imageUrl" :class="$style.image">
		<div v-else :class="$style.mediaLabel"><i :class="asset.fileDataType.startsWith('font/') ? 'ti ti-typography' : asset.fileDataType.startsWith('audio/') ? 'ti ti-music' : 'ti ti-movie'"></i> {{ asset.fileDataType }}</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { shallowRef, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import { i18n } from '@/i18n.ts';
import type { Asset } from '@glitch/shared/types.ts';
import * as api from '@/api.ts';
import { appStateManager } from '@/app.ts';
import { popup } from '@/ui.ts';
import GsDialog from './common/GsDialog.vue';

const props = defineProps<{
	asset: Asset;
}>();

const imageUrl = shallowRef<string>();

function remove() {
	appStateManager.commit('removeAsset', {
		assetId: props.asset.id,
	});
}

async function rename() {
	const { dispose } = popup(GsDialog, { input: { default: props.asset.name } }, {
		done: result => {
			if (!result.canceled && typeof result.result === 'string') {
				appStateManager.commit('renameAsset', { assetId: props.asset.id, name: result.result });
			}
		},
		closed: () => dispose(),
	});
}

async function replace() {
	const result = await api.openMediaFile({ includeFonts: true });
	if (!result) return;
	appStateManager.commit('replaceAsset', {
		id: props.asset.id,
		name: props.asset.name,
		assetId: props.asset.id,
		width: result.width,
		height: result.height,
		fileDataType: result.type,
		fileData: result.fileData,
		hash: result.hash, // TODO
	});
}

watch(() => [props.asset.fileData, props.asset.fileDataType] as const, ([file, type], _previous, onCleanup) => {
	imageUrl.value = undefined;
	if (!type.startsWith('image/')) return;
	const url = URL.createObjectURL(file);
	imageUrl.value = url;
	// 差し替え・削除時にBlobへの参照を残さない。
	onCleanup(() => URL.revokeObjectURL(url));
}, { immediate: true });

</script>

<style module lang="scss">
.root {
	position: relative;
	background: rgba(255, 255, 255, 0.1);
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
	overflow: hidden;
}

.header {
	padding: 0 88px 0 8px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-weight: bold;
	background: linear-gradient(0deg, rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.025));
	border-bottom: solid 1px rgba(0, 0, 0, 0.5);
	line-height: 32px;
	text-shadow: 0 -1px #000;

	&.disabled {
		pointer-events: none;
	}
}

.buttons {
	position: absolute;
	top: 4px;
	right: 4px;
	text-align: right;
	width: 85px;
}

.button {
	display: inline-block;
	width: 23px;
	height: 23px;
	font-size: 90%;
	padding-left: 0;
	padding-right: 0;
}

.body {
	height: 120px;
	padding: 8px;
}

.image {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.mediaLabel {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	height: 100%;
	opacity: 0.7;
}
</style>
