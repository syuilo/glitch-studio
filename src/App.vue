<template>
<main id="app">
	<div class="view">
		<img ref="canvas"/>
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

	mounted() {
		chooseFile().then(path => {
			render(path).then(async img => {
				console.log('Generating buffer');
				const buffer = await img.getBufferAsync('image/png');
				console.log('Generated');
				this.$refs.canvas.src = URL.createObjectURL(new Blob([buffer], {type: 'image/png'}));
			});
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

		> img {
			width: 100%;
			height: 100%;
			object-fit: contain;
		}
	}
}
</style>
