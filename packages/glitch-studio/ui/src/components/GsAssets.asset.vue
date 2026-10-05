<template>
<GsFolder>
	<template #label>{{ asset.name }}</template>
	<template #icon>
		<i :class="asset.fileDataType.startsWith('font/') ? 'ti ti-typography' : asset.fileDataType.startsWith('audio/') ? 'ti ti-music' : 'ti ti-movie'"></i>
	</template>
	<template #footer>
		<div style="display: flex; gap: 4px;">
			<GsButton iconOnly :class="$style.button" :vTooltip="i18n.ts.ReplaceAsset" @click="replace()"><i class="ti ti-replace"></i></GsButton>
			<GsButton iconOnly :class="$style.button" :vTooltip="i18n.ts.RenameAsset" @click="rename()"><i class="ti ti-cursor-text"></i></GsButton>
			<GsButton iconOnly danger :class="$style.button" :vTooltip="i18n.ts.RemoveAsset" @click="remove()"><i class="ti ti-trash"></i></GsButton>
		</div>
	</template>

	<div :class="$style.root">
		<img v-if="imageUrl" :src="imageUrl" :class="$style.image">
		<div v-else :class="$style.mediaLabel"><i :class="asset.fileDataType.startsWith('font/') ? 'ti ti-typography' : asset.fileDataType.startsWith('audio/') ? 'ti ti-music' : 'ti ti-movie'"></i> {{ asset.fileDataType }}</div>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { shallowRef, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import GsDialog from './common/GsDialog.vue';
import GsFolder from './common/GsFolder.vue';
import type { Asset } from '@gs/shared/types.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import * as api from '@/api.ts';
import { popup } from '@/ui.ts';

const { stateManager } = appContext.projectContext;

const props = defineProps<{
	asset: Asset;
}>();

const imageUrl = shallowRef<string>();

function remove() {
	stateManager.commit('removeAsset', {
		assetId: props.asset.id,
	});
}

async function rename() {
	const { dispose } = popup(GsDialog, { input: { default: props.asset.name } }, {
		done: result => {
			if (!result.canceled && typeof result.result === 'string') {
				stateManager.commit('renameAsset', { assetId: props.asset.id, name: result.result });
			}
		},
		closed: () => dispose(),
	});
}

async function replace() {
	const result = await api.openMediaFile({ includeFonts: true });
	if (!result) return;
	stateManager.commit('replaceAsset', {
		id: props.asset.id,
		name: props.asset.name,
		assetId: props.asset.id,
		width: result.width,
		height: result.height,
		fileDataType: result.type,
		fileData: result.fileData,
		sourceFilePath: result.sourceFilePath,
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
}
</style>
