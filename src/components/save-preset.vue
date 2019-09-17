<template>
<div class="save-preset-componet">
	<div class="_gs-container">
		<div>
			<input type="text" v-model="name"/>
		</div>
		<button @click="save()">Save</button>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import uuid from 'uuid/v4';
import { SettingsStore } from '@/settings';
import { version } from '@/version';
import { ipcRenderer } from 'electron';

export default Vue.extend({
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
		}
	}
});
</script>

<style scoped lang="scss">
.save-preset-componet {
	position: fixed;
	z-index: 1000;
	top: 35px;
	left: 8px;
	width: calc(100% - (8px * 2));
	height: calc(100% - 43px);
	background: rgba(0, 0, 0, 0.1);
	backdrop-filter: blur(4px);
	border-radius: 6px;

	> div {
		position: absolute;
		top: 128px;
		right: 0;
		left: 0;
		width: 300px;
		margin: auto;
		padding: 32px;
		text-align: center;
		font-size: 14px;

		> div {
			margin: 0 0 16px 0;
		}

		> button {
			margin-top: 24px;
		}
	}
}
</style>
