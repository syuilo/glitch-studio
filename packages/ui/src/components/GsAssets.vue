<template>
<div :class="$style.root">
	<div :class="$style.actions">
		<GsButton @click="addAsset">Add asset</GsButton>
		<GsButton :disabled="!localFontsSupported || loadingLocalFonts" :wait="loadingLocalFonts" @click="addLocalFont">Import local font</GsButton>
	</div>
	<div v-if="!localFontsSupported">Local fonts are unavailable. Use Add asset to import a font file.</div>
	<div v-if="localFontError">{{ localFontError }}</div>
	<div :class="$style.assets">
		<div v-for="asset in appStateManager.state.assets.value" :key="asset.id" :class="$style.asset">
			<XAsset :asset="asset"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import GsButton from './common/GsButton.vue';
import XAsset from './GsAssets.asset.vue';
import GsLocalFontDialog from './GsLocalFontDialog.vue';
import { appStateManager } from '@/app.ts';
import * as api from '@/api.ts';
import { popup } from '@/ui.ts';
import { localFontErrorMessage, queryLocalFonts, supportsLocalFonts } from '@/utility/local-fonts.ts';

const localFontsSupported = supportsLocalFonts();
const loadingLocalFonts = ref(false);
const localFontError = ref<string | null>(null);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

async function addLocalFont() {
	if (loadingLocalFonts.value) return;
	loadingLocalFonts.value = true;
	localFontError.value = null;
	try {
		const fonts = await queryLocalFonts();
		if (disposed) return;
		const { dispose } = popup(GsLocalFontDialog, { fonts }, { closed: () => dispose() });
	} catch (error) {
		if (!disposed) localFontError.value = localFontErrorMessage(error);
	} finally {
		loadingLocalFonts.value = false;
	}
}

async function addAsset() {
	const result = await api.openMediaFile({ includeFonts: true });
	if (!result) return;
	const assetId = genId();
	appStateManager.commit('addAsset', {
		id: assetId,
		name: result.name,
		width: result.width,
		height: result.height,
		fileDataType: result.type,
		fileData: result.fileData,
		hash: result.hash, // TODO
	});
	if (result.type.startsWith('audio/') || result.type.startsWith('video/')) {
		appStateManager.commit('addPlayer', { id: genId(), name: result.name, sourceType: 'asset', assetId });
	}
}

</script>

<style module lang="scss">
.root {

}

.actions {
	display: flex;
	gap: 8px;
	margin-bottom: 12px;
}

.assets {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: 16px;
}

.asset {
}
</style>
