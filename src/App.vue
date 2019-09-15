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
* {
	user-select: none;
}

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

input {
	display: block;
	box-sizing: border-box;
	appearance: none;
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	background: rgba(0, 0, 0, 0.3);
	box-shadow: 0 2px 1px rgba(0, 0, 0, 0.5) inset;
	color: #fff;
	padding: 4px 6px;
	outline: none;
	max-width: 100%;

	&:focus {
		border-color: #bb6100;
	}
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
