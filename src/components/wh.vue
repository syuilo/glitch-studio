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

	data() {
		return {
			w: 0,
			h: 0,
		};
	},

	created() {
		this.w = this.wh[0] as number;
		this.h = this.wh[1] as number;
	},

	methods: {
		change(wh: string, value: number) {
			(this as any)[wh] = value;
			this.$emit('input', [this.w, this.h]);
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
