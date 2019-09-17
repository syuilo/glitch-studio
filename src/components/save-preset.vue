<template>
<XDialog>
	<div class="save-preset-componet">
		<div>
			<input type="text" v-model="name"/>
		</div>
		<footer>
			<button @click="cancel()">Cancel</button>
			<button class="primary" @click="save()">Save</button>
		</footer>
	</div>
</XDialog>
</template>

<script lang="ts">
import Vue from 'vue';
import uuid from 'uuid/v4';
import { SettingsStore } from '@/settings';
import { version } from '@/version';
import { ipcRenderer } from 'electron';
import XDialog from './dialog.vue';

export default Vue.extend({
	components: { XDialog },

	data() {
		return {
			name: ''
		};
	},

	methods: {
		save() {
			((this as any).$root.settingsStore as SettingsStore).settings.presets.push({
				id: uuid(),
				gsVersion: version,
				name: this.name,
				author: '',
				layers: this.$store.state.layers,
				macros: this.$store.state.macros,
			});
			((this as any).$root.settingsStore as SettingsStore).save();
			ipcRenderer.send('updatePresets', ((this as any).$root.settingsStore as SettingsStore).settings.presets.map(p => ({
				id: p.id, name: p.name
			})));
			this.$emit('ok');
		},

		cancel() {
			this.$emit('ok');
		}
	}
});
</script>

<style scoped lang="scss">
.save-preset-componet {
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
