<template>
<XDialog>
	<div class="about-componet">
		<div>
			<div><b>Glitch Studio</b></div>
			<div style="margin-bottom: 4px;">{{ version }}</div>
			<a class="_gs-link" @click="open('https://github.com/syuilo/glitch-studio/releases')">Check latest release</a>
		</div>
		<div>
			<small style="display: block;">
				<div>Copyright (c) 2019 syuilo</div>
				<a class="_gs-link" @click="open('https://github.com/syuilo/glitch-studio')">https://github.com/syuilo/glitch-studio</a>
			</small>
		</div>
		<button @click="$emit('ok')">OK</button>
	</div>
</XDialog>
</template>

<script lang="ts">
import Vue from 'vue';
import { version } from '../version';
import { shell } from 'electron';
import XDialog from './dialog.vue';

export default Vue.extend({
	components: { XDialog },

	data() {
		return {
			version: version
		};
	},

	methods: {
		open(url: string) {
			shell.openExternal(url);
		}
	}
});
</script>

<style scoped lang="scss">
.about-componet {
	> div {
		margin: 0 0 16px 0;
	}

	> button {
		margin-top: 24px;
	}
}
</style>
