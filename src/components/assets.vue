<template>
<div class="assets-componet _gs-container">
	<header>
		<button @click="addAsset()">Add Asset...</button>
	</header>
	<div class="assets" v-if="$store.state.assets.length === 0">
		<p class="_gs-no-contents">No Assets</p>
	</div>
	<div class="assets" v-else>
		<XAsset v-for="asset in $store.state.assets" :asset="asset" :key="asset.id"/>
	</div>
</div>
</template>

<script lang="ts">
import * as fs from 'fs';
import * as electron from 'electron';
import Vue from 'vue';
import uuid from 'uuid/v4';
import XAsset from './asset.vue';
import { loadImage } from '../load-image';

export default Vue.extend({
	components: {
		XAsset
	},

	methods: {
		addAsset() {
			const paths = electron.remote.dialog.showOpenDialogSync(electron.remote.BrowserWindow.getFocusedWindow()!, {
				properties: ['openFile'],
				filters: [{
					name: 'Image',
					extensions: ['png', 'jpg', 'jpe', 'jpeg', '.jfif', '.jfi', '.jif', 'bmp', 'tiff']
				}]
			});
			if (paths == null) return;
			const path = paths[0];
			const buffer = fs.readFileSync(path);
			const img = loadImage(buffer);
			this.$store.commit('addAsset', {
				id: uuid(),
				name: path.replace(/\\/g, '/').split('/').pop(),
				width: img.width,
				height: img.height,
				data: img.data,
				buffer: buffer,
			});
		}
	}
});
</script>

<style scoped lang="scss">
.assets-componet {
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	padding: 8px;

	> header {
		padding-bottom: 8px;
	}

	> .assets {
		flex: 1;
		overflow: auto;
		border: solid 1px rgba(255, 255, 255, 0.1);
		background: rgba(0, 0, 0, 0.3);
		box-shadow: 0 2px 2px rgba(0, 0, 0, 0.7) inset;
		border-radius: 6px;

		> *:not(p) {
			margin: 8px;
		}
	}
}
</style>
