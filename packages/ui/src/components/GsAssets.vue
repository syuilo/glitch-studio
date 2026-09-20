<template>
<div :class="$style.root">
	<GsButton @click="addAsset">Add asset</GsButton>
	<div :class="$style.assets">
		<div v-for="asset in appContext.state.assets.value" :key="asset.id" :class="$style.asset">
			<XAsset :asset="asset"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { genId } from '@glitch/shared/utility/id.ts';
import GsButton from './common/GsButton.vue';
import XAsset from './GsAssets.asset.vue';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import * as api from '@/api.ts';

async function addAsset() {
	const result = await api.openMediaFile({});
	if (!result) return;
	const assetId = genId();
	appContext.commit('addAsset', {
		id: assetId,
		name: result.name,
		width: result.width,
		height: result.height,
		data: result.data,
		fileDataType: result.type,
		fileData: result.fileData,
		hash: result.hash, // TODO
	});
	if (result.type.startsWith('audio/') || result.type.startsWith('video/')) {
		appContext.commit('addPlayer', { id: genId(), name: result.name, sourceType: 'asset', assetId });
	}
}

</script>

<style module lang="scss">
.root {

}

.assets {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: 16px;
}

.asset {
}
</style>
