<template>
<div :class="$style.root">
	<div :class="$style.actions">
		<GsButton @click="addAsset">Add asset</GsButton>
		<GsButton :disabled="!localFontsSupported || loadingLocalFonts" :wait="loadingLocalFonts" @click="addLocalFont">Import local font</GsButton>
	</div>
	<div v-if="!localFontsSupported">Local fonts are unavailable. Use Add asset to import a font file.</div>
	<div v-if="localFontError">{{ localFontError }}</div>
	<div :class="$style.assets">
		<GsAsset v-for="asset in stateManager.state.assets.value" :key="asset.id" :asset="asset"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { inject, onBeforeUnmount, ref } from 'vue';
import GsButton from './common/GsButton.vue';
import GsAsset from './GsAsset.vue';
import GsLocalFontDialog from './GsLocalFontDialog.vue';
import { appContext } from '@/app.ts';
import { importAssets } from '@/utility/import-assets.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';
import { popup } from '@/ui.ts';
import { localFontErrorMessage, queryLocalFonts, supportsLocalFonts } from '@/utility/local-fonts.ts';

const { stateManager } = appContext.projectContext;
const workspaceController = inject(workspaceControllerKey)!;

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
	const ids = await importAssets(appContext.projectContext);
	if (ids.length > 0) workspaceController.revealPanel({ contentType: 'assets', sourcePanelId: null });
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
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: 8px;
	overflow: auto;
}

</style>
