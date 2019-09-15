<template>
<main id="app">
	<div class="view">
		<canvas :width="width" :height="height" ref="canvas"/>
	</div>
	<div class="nav">
		<div class="layers">
			<XLayers/>
		</div>
	</div>
</main>
</template>

<script lang="ts">
import Vue from 'vue';
import * as Jimp from 'jimp';
import XLayers from './components/layers.vue';
import { chooseFile } from './choose-file';
import { render } from './glitch';

export default Vue.extend({
	name: 'app',

	components: {
		XLayers
	},

	data() {
		return {
			img: null,
			width: 0,
			height: 0,
		};
	},

	computed: {
		canvas(): HTMLCanvasElement {
			return this.$refs.canvas as HTMLCanvasElement;
		}
	},

	mounted() {
		this.chooseFile();

		this.$watch('$store.state.layers', () => {
			this.render();
		}, { deep: true });
	},

	methods: {
		chooseFile() {
			chooseFile().then(async path => {
				this.img = await Jimp.default.read(path);
				this.render();
			});
		},

		render() {
			render(this.img, this.$store.state.layers, (w, h) => new Promise((res, rej) => {
				this.width = w;
				this.height = h;
				this.$nextTick(() => {
					res(this.canvas.getContext('2d')!);
				});
			}));
		}
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
	display: flex;
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

	> .nav {
		width: 30%;
		height: 100%;
	}
}
</style>
