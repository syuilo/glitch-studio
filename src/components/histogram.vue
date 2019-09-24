<template>
<div class="histogram-component">
	<canvas :width="width" :height="height" ref="histogram"/>
</div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
	props: {
		histogram: {
			type: Object,
			required: true
		},
	},

	data() {
		return {
			width: 256,
			height: 150
		};
	},

	watch: {
		histogram() {
			this.render();
		}
	},

	mounted() {
		this.render();
	},

	methods: {
		render() {
			const ctx = (this.$refs.histogram as HTMLCanvasElement).getContext('2d')!;
			ctx.clearRect(0, 0, this.width, this.height);
			ctx.globalCompositeOperation = 'lighter';
			ctx.lineWidth = 1;

			for (let i = 0; i < 256; i++) {
				const r = (this.histogram.bins.r[i] / this.histogram.rgbMax) * this.height;
				ctx.strokeStyle = '#f00';
				ctx.beginPath();
				ctx.moveTo(i, 255);
				ctx.lineTo(i, Math.max(0, this.height - r));
				ctx.closePath();
				ctx.stroke();

				const g = (this.histogram.bins.g[i] / this.histogram.rgbMax) * this.height;
				ctx.strokeStyle = '#0f0';
				ctx.beginPath();
				ctx.moveTo(i, 255);
				ctx.lineTo(i, this.height - g);
				ctx.closePath();
				ctx.stroke();

				const b = (this.histogram.bins.b[i] / this.histogram.rgbMax) * this.height;
				ctx.strokeStyle = '#00f';
				ctx.beginPath();
				ctx.moveTo(i, 255);
				ctx.lineTo(i, this.height - b);
				ctx.closePath();
				ctx.stroke();
			}
		}
	}
});
</script>

<style scoped lang="scss">
.histogram-component {
	> canvas {
		display: block;
	}
}
</style>
