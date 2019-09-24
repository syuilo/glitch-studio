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

			//#region Draw grid
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';

			// X axis
			const xLines = 6;
			for (let i = 0; i <= xLines; i++) {
				ctx.beginPath();
				ctx.moveTo(Math.floor(i * ((this.width - 1) / xLines)) + 0.5, 0);
				ctx.lineTo(Math.floor(i * ((this.width - 1) / xLines)) + 0.5, this.height);
				ctx.closePath();
				ctx.stroke();
			}

			// Y axis
			const yLines = 6;
			for (let i = 0; i <= yLines; i++) {
				ctx.beginPath();
				ctx.moveTo(0, Math.floor(i * ((this.height - 1) / yLines)) + 0.5);
				ctx.lineTo(this.width, Math.floor(i * ((this.height - 1) / yLines)) + 0.5);
				ctx.closePath();
				ctx.stroke();
			}
			//#endregion

			for (let i = 0; i < 256; i++) {
				const r = (this.histogram.bins.r[i] / this.histogram.rgbMax) * this.height;
				ctx.strokeStyle = `rgb(${i}, 0, 0)`;
				ctx.beginPath();
				ctx.moveTo(i + 0.5, 255);
				ctx.lineTo(i + 0.5, Math.max(0, this.height - r));
				ctx.closePath();
				ctx.stroke();

				const g = (this.histogram.bins.g[i] / this.histogram.rgbMax) * this.height;
				ctx.strokeStyle = `rgb(0, ${i}, 0)`;
				ctx.beginPath();
				ctx.moveTo(i + 0.5, 255);
				ctx.lineTo(i + 0.5, this.height - g);
				ctx.closePath();
				ctx.stroke();

				const b = (this.histogram.bins.b[i] / this.histogram.rgbMax) * this.height;
				ctx.strokeStyle = `rgb(0, 0, ${i})`;
				ctx.beginPath();
				ctx.moveTo(i + 0.5, 255);
				ctx.lineTo(i + 0.5, this.height - b);
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
