<template>
<div class="wh-component">
	<input type="number" :value="w" @change="change('w', parseInt($event.target.value, 10))"/>
	<input type="number" :value="h" @change="change('h', parseInt($event.target.value, 10))"/>
</div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
	props: {
		wh: {
			type: Array,
			required: true
		}
	},

	computed: {
		w(): number {
			return this.wh[0] as number;
		},
		h(): number {
			return this.wh[1] as number;
		},
	},

	methods: {
		change(wh: string, value: number) {
			this.$emit('input', [
				wh === 'w' ? value : this.w,
				wh === 'h' ? value : this.h,
			]);
		}
	}
});
</script>

<style scoped lang="scss">
.wh-component {
	display: flex;

	> *:first-child {
		margin-right: 4px;
	}
}
</style>
