<template>
<div class="xy-component">
	<input type="number" :value="x" @change="change('x', parseInt($event.target.value, 10))"/>
	<input type="number" :value="y" @change="change('y', parseInt($event.target.value, 10))"/>
</div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
	props: {
		xy: {
			type: Array,
			required: true
		}
	},

	computed: {
		x(): number {
			return this.xy[0] as number;
		},
		y(): number {
			return this.xy[1] as number;
		},
	},

	methods: {
		change(xy: string, value: number) {
			this.$emit('input', [
				xy === 'x' ? value : this.x,
				xy === 'y' ? value : this.y,
			]);
		}
	}
});
</script>

<style scoped lang="scss">
.xy-component {
	display: flex;

	> *:first-child {
		margin-right: 4px;
	}
}
</style>
