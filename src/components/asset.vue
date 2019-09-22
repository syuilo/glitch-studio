<template>
<div class="asset-component">
	<header>{{ asset.name }}</header>
	<div class="buttons">
		<button class="rename" @click="rename()" title="Rename"><fa :icon="faICursor"/></button>
		<button class="remove" @click="remove()" title="Remove asset"><fa :icon="faTrashAlt"/></button>
	</div>
	<div class="body">
		<canvas :width="asset.width" :height="asset.height" ref="canvas"/>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import { faICursor } from '@fortawesome/free-solid-svg-icons';
import { faTrashAlt } from '@fortawesome/free-regular-svg-icons';

export default Vue.extend({
	props: {
		asset: {
			type: Object,
			required: true
		},
	},

	data() {
		return {
			faICursor, faTrashAlt
		};
	},

	computed: {
		canvas(): HTMLCanvasElement {
			return this.$refs.canvas as HTMLCanvasElement;
		}
	},

	mounted() {
		const ctx = this.canvas.getContext('2d')!;
		ctx.putImageData(new ImageData(new Uint8ClampedArray(this.asset.data), this.asset.width, this.asset.height), 0, 0);
	},

	methods: {
		remove() {
			this.$store.commit('removeAsset', {
				assetId: this.asset.id,
			});
		}
	}
});
</script>

<style scoped lang="scss">
.asset-component {
	position: relative;
	background: rgba(255, 255, 255, 0.1);
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
	overflow: hidden;

	> header {
		padding: 0 88px 0 20px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 14px;
		font-weight: bold;
		background: linear-gradient(0deg, rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.025));
		border-bottom: solid 1px rgba(0, 0, 0, 0.5);
		line-height: 32px;
		text-shadow: 0 -1px #000;

		&.disabled {
			pointer-events: none;
		}
	}

	> .buttons {
		position: absolute;
		top: 4px;
		right: 4px;
		text-align: right;
		width: 85px;

		> button {
			display: inline-block;
			width: 23px;
			height: 23px;
			font-size: 12px;
			padding-left: 0;
			padding-right: 0;

			&:not(:first-child) {
				margin-left: 6px;
			}

			> * {
				height: 100%;
			}
		}
	}

	> .body {
		height: 120px;
		padding: 8px;

		> canvas {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: contain;
		}
	}
}
</style>
