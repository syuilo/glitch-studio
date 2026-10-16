<template>
<div :class="$style.root">
	<div :class="$style.actions">
		<GsButton primary @click="addAsset"><i class="ti ti-plus"></i> {{ i18n.ts._Assets.Add }}</GsButton>
		<GsButton :disabled="!localFontsSupported || loadingLocalFonts" :wait="loadingLocalFonts" @click="addLocalFont">{{ i18n.ts._Assets.ImportLocalFont }}</GsButton>
		<GsInput v-model="query" type="search" :placeholder="i18n.ts._Assets.Search" :class="$style.searchInput" @keydown.enter.stop.prevent="chooseFirstResult">
			<template #prefix>
				<i class="ti ti-search"></i>
			</template>
		</GsInput>
	</div>
	<div v-if="!localFontsSupported">{{ i18n.ts._Assets.LocalFontsUnavailable }}</div>
	<div v-if="localFontError">{{ localFontError }}</div>
	<div :class="$style.assets">
		<GsAsset
			v-for="asset in filteredAssets"
			:key="asset.id"
			:asset="asset"
			:isSelected="selectedAssets.some(x => x.id === asset.id)"
			@click="onAssetClick($event, asset)"
			@dblclick="emit('assetDoubleClicked', asset)"
		/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import GsAsset from './GsAsset.vue';
import GsInput from './common/GsInput.vue';
import GsLocalFontDialog from './GsLocalFontDialog.vue';
import type { ProjectAsset } from '@/Project.ts';
import { appContext } from '@/app.ts';
import { importAssets } from '@/utility/import-assets.ts';
import { getAssetMenu } from '@/utility/asset-menu.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';
import { popup, popupMenu } from '@/ui.ts';
import { localFontErrorMessage, queryLocalFonts, supportsLocalFonts } from '@/utility/local-fonts.ts';

const props = withDefaults(defineProps<{
	/** 完全なMIMEタイプ、image/*などのワイルドカード、またはnull（絞り込みなし）。 */
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
	(ev: 'assetDoubleClicked', asset: ProjectAsset): void;
}>();

const { stateManager } = appContext.projectContext;
const workspaceController = inject(workspaceControllerKey)!;

const selectedAssets = ref<ProjectAsset[]>([]);

watch(selectedAssets, (newValue) => {
	emit('changeSelectedAssets', newValue);
}, { deep: true });

const isEditMode = ref(false);

const query = ref('');

const assetsByMimeType = computed(() => {
	const mimeType = props.mimeType?.trim().toLowerCase() ?? null;
	return stateManager.state.assets.value.filter(asset => {
		if (mimeType == null || mimeType === '' || mimeType === '*/*') return true;
		const assetMimeType = asset.fileDataType.toLowerCase();
		return mimeType.endsWith('/*')
			? assetMimeType.startsWith(mimeType.slice(0, -1))
			: assetMimeType === mimeType;
	});
});

const filteredAssets = computed(() => {
	const filenameQuery = query.value.trim().toLowerCase();
	return assetsByMimeType.value.filter(asset => asset.name.toLowerCase().includes(filenameQuery));
});

watch(assetsByMimeType, assets => {
	// 検索中も選択は保持するが、削除された素材やMIMEタイプの条件から外れた素材は確定できないようにする。
	const availableIds = new Set(assets.map(asset => asset.id));
	const selected = selectedAssets.value.filter(asset => availableIds.has(asset.id));
	if (selected.length !== selectedAssets.value.length) selectedAssets.value = selected;
});

function onAssetClick(ev: PointerEvent, asset: ProjectAsset) {
	if (props.select == null && ev.shiftKey) {
		isEditMode.value = true;
	}
	if (props.select == null && !isEditMode.value) {
		popupMenu(getAssetMenu(asset), ev.currentTarget ?? ev.target);
		return;
	}
	toggleAssetSelection(asset);
}

function toggleAssetSelection(asset: ProjectAsset) {
	if (props.select !== 'asset' && !isEditMode.value) return;
	const isAlreadySelected = selectedAssets.value.some(selected => selected.id === asset.id);
	if (props.multiple || isEditMode.value) {
		selectedAssets.value = isAlreadySelected
			? selectedAssets.value.filter(selected => selected.id !== asset.id)
			: [...selectedAssets.value, asset];
	} else {
		selectedAssets.value = [asset];
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
	const asset = filteredAssets.value[0];
	if (asset != null) toggleAssetSelection(asset);
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
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 12px;
}

.searchInput {
	flex: 1;
	min-width: 160px;
}

.assets {
	flex: 1;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: 8px;
	overflow: auto;
}

</style>
