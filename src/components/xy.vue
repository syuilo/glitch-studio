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

	data() {
		return {
			x: 0,
			y: 0,
		};
	},

	created() {
		this.x = this.xy[0] as number;
		this.y = this.xy[1] as number;
	},

	methods: {
		change(xy: string, value: number) {
			(this as any)[xy] = value;
			this.$emit('input', [this.x, this.y]);
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
