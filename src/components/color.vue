<template>
<div class="color-component">
	<input type="color" :value="rgbToHex(color)" @change="change($event.target.value)"/>
</div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
	props: {
		color: {
			type: Array,
			required: true
		}
	},

	methods: {
		rgbToHex(rgb: number[]) {
			function componentToHex(c: number) {
				const hex = c.toString(16);
				return hex.length === 1 ? '0' + hex : hex;
			}

			return '#' + componentToHex(rgb[0]) + componentToHex(rgb[1]) + componentToHex(rgb[2]);
		},

		hexToRgb(hex: string) {
			const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)!;
			return [
				parseInt(result[1], 16),
				parseInt(result[2], 16),
				parseInt(result[3], 16),
			];
		},

		change(color: string) {
			this.$emit('input', this.hexToRgb(color));
		}
	}
});
</script>

<style scoped lang="scss">
.color-component {

}
</style>
