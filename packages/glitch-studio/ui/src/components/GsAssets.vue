<template>
<div :class="$style.root">
	<div :class="$style.actions">
		<GsButton @click="addAsset">Add asset</GsButton>
		<GsButton :disabled="!localFontsSupported || loadingLocalFonts" :wait="loadingLocalFonts" @click="addLocalFont">Import local font</GsButton>
	</div>
	<div v-if="!localFontsSupported">Local fonts are unavailable. Use Add asset to import a font file.</div>
	<div v-if="localFontError">{{ localFontError }}</div>
	<div :class="$style.assets">
		<div v-for="asset in stateManager.state.assets.value" :key="asset.id" :class="$style.asset">
			<XAsset :asset="asset"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import GsButton from './common/GsButton.vue';
import XAsset from './GsAssets.asset.vue';
import GsLocalFontDialog from './GsLocalFontDialog.vue';
import { appContext } from '@/app.ts';
import * as api from '@/api.ts';
import { popup } from '@/ui.ts';
import { localFontErrorMessage, queryLocalFonts, supportsLocalFonts } from '@/utility/local-fonts.ts';

const { stateManager } = appContext.projectContext;

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
	const results = await api.openMediaFile({ multiple: true, includeFonts: true });
	if (!results) return;
	for (const result of results) {
		const assetId = genId();
		stateManager.commit('addAsset', {
			id: assetId,
			name: result.name,
			width: result.width,
			height: result.height,
			fileDataType: result.type,
			fileData: result.fileData,
			sourceFilePath: result.sourceFilePath,
			hash: result.hash, // TODO
		});
		if (result.type.startsWith('audio/') || result.type.startsWith('video/')) {
			stateManager.commit('addPlayer', { id: genId(), name: result.name, sourceType: 'asset', assetId });
		}
	}
}

</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: 100%;
}

.actions {
	display: flex;
	gap: 8px;
	margin-bottom: 12px;
}

.assets {
	flex: 1;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: 8px;
	overflow: auto;
}

.asset {
}
</style>
