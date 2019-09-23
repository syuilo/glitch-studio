<template>
<XDialog>
	<div class="export-preset-componet">
		<div>
			<input type="text" v-model="name"/>
		</div>
		<footer>
			<button @click="cancel()">Cancel</button>
			<button class="primary" @click="save()">Export</button>
		</footer>
	</div>
</XDialog>
</template>

<script lang="ts">
import * as fs from 'fs';
import Vue from 'vue';
import uuid from 'uuid/v4';
import * as electron from 'electron';
import { SettingsStore } from '@/settings';
import { version } from '@/version';
import { encodeAssets } from '@/encode-assets';
import { ipcRenderer } from 'electron';
import XDialog from './dialog.vue';
import { encode } from '@msgpack/msgpack';

export default Vue.extend({
	components: { XDialog },

	data() {
		return {
			name: ''
		};
	},

	methods: {
		save() {
			const data = encode({
				id: uuid(),
				gsVersion: version,
				name: this.name,
				author: '',
				layers: this.$store.state.layers,
				macros: this.$store.state.macros,
				assets: encodeAssets(this.$store.state.assets),
			});
			const path = electron.remote.dialog.showSaveDialogSync(electron.remote.BrowserWindow.getFocusedWindow()!, {
				defaultPath: this.name,
				filters: [{
					name: 'Glitch Studio Preset',
					extensions: ['gsp']
				}]
			});
			if (path == null) return;
			fs.writeFile(path, data, error => {
				if (error != null) {
					alert("save error.");
					return;
				}
			})
			this.$emit('ok');
		},

		cancel() {
			this.$emit('ok');
		}
	}
});
</script>

<style scoped lang="scss">
.export-preset-componet {
	> div {
		margin: 0 0 16px 0;
	}

	> footer {
		display: flex;
		margin-top: 24px;

		> button:first-child {
			margin-right: 16px;
		}
	}
}
</style>
