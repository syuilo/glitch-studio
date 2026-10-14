<template>
<div :class="$style.root">
	<div :class="$style.actions">
		<GsButton primary @click="addAsset"><i class="ti ti-plus"></i> Add Asset...</GsButton>
		<GsButton :disabled="!localFontsSupported || loadingLocalFonts" :wait="loadingLocalFonts" @click="addLocalFont">Import local font</GsButton>
		<GsInput ref="searchInput" v-model="query" type="search" placeholder="Search" :class="$style.searchInput" @keydown.enter.stop.prevent="chooseFirstResult">
			<template #prefix>
				<i class="ti ti-search"></i>
			</template>
		</GsInput>
	</div>
	<div v-if="!localFontsSupported">Local fonts are unavailable. Use Add asset to import a font file.</div>
	<div v-if="localFontError">{{ localFontError }}</div>
	<div :class="$style.assets">
		<GsAsset
			v-for="asset in stateManager.state.assets.value"
			:key="asset.id"
			:asset="asset"
			:isSelected="selectedAssets.some(x => x.id === asset.id)"
			@click="onAssetClick($event, asset)"
		/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { inject, onBeforeUnmount, ref, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import GsAsset from './GsAsset.vue';
import GsInput from './common/GsInput.vue';
import GsLocalFontDialog from './GsLocalFontDialog.vue';
import type { ProjectAsset } from '@/Project.ts';
import { appContext } from '@/app.ts';
import { importAssets } from '@/utility/import-assets.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';
import { popup } from '@/ui.ts';
import { localFontErrorMessage, queryLocalFonts, supportsLocalFonts } from '@/utility/local-fonts.ts';

const props = withDefaults(defineProps<{
	mimeType?: string | null;
	multiple?: boolean;
	select?: 'asset' | 'folder' | null;
}>(), {
	mimeType: null,
	multiple: false,
	select: null,
});

const emit = defineEmits<{
	(ev: 'changeSelectedAssets', v: ProjectAsset[]): void;
}>();

const { stateManager } = appContext.projectContext;
const workspaceController = inject(workspaceControllerKey)!;

const selectedAssets = ref<ProjectAsset[]>([]);

watch(selectedAssets, (newValue) => {
	emit('changeSelectedAssets', newValue);
}, { deep: true });

const isEditMode = ref(false);

const query = ref('');

function onAssetClick(ev: PointerEvent, asset: ProjectAsset) {
	if (ev.shiftKey) {
		isEditMode.value = true;
	}

	if (props.select === 'asset' || isEditMode.value) {
		const isAlreadySelected = selectedAssets.value.some(x => x.id === asset.id);

		if (isEditMode.value) {
			if (isAlreadySelected) {
				selectedAssets.value = selectedAssets.value.filter(x => x.id !== asset.id);
			} else {
				selectedAssets.value.push(asset);
			}
			return;
		}

		if (props.multiple) {
			if (isAlreadySelected) {
				selectedAssets.value = selectedAssets.value.filter(x => x.id !== asset.id);
			} else {
				selectedAssets.value.push(asset);
			}
		} else {
			if (isAlreadySelected) {
				//emit('selected', file);
			} else {
				selectedAssets.value = [asset];
			}
		}
	} else {
		// TODO
		//ui.popupMenu(getAssetMenu(asset), (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
	}
}

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

function chooseFirstResult() {
	// TODO
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
