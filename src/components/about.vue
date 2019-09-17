<template>
<div class="about-componet">
	<div class="_gs-container">
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
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import { version } from '../version';
import { shell } from 'electron';

export default Vue.extend({
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
	}
}
</style>
