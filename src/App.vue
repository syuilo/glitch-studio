<template>
<main id="app">
	<div class="view">
		<canvas :width="width" :height="height" ref="canvas"/>
	</div>
</main>
</template>

<script lang="ts">
import Vue from 'vue';
import HelloWorld from './components/HelloWorld.vue';
import { chooseFile } from './choose-file';
import { render } from './glitch';

export default Vue.extend({
	name: 'app',

	components: {
		HelloWorld
	},

	data() {
		return {
			width: 0,
			height: 0,
		};
	},

	mounted() {
		chooseFile().then(path => {
			render(path, (w, h) => new Promise((res, rej) => {
				this.width = w;
				this.height = h;
				this.$nextTick(() => {
					res(this.$refs.canvas.getContext('2d'));
				});
			}));
		});
	}
});
</script>

<style lang="scss">
html {
	height: 100%;
	background: #222;
	color: #fff;
	font-family: 'Avenir', Helvetica, Arial, sans-serif;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

body {
	height: 100%;
	margin: 0;
}

#app {
	height: 100%;

	> .view {
		width: 70%;
		height: 100%;

		> * {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: contain;
		}
	}
}
</style>
