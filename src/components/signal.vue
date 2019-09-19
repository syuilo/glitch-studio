<template>
<div class="signal-component">
	<button @click="change('r')" :class="{ primary: r }">R</button>
	<button @click="change('g')" :class="{ primary: g }">G</button>
	<button @click="change('b')" :class="{ primary: b }">B</button>
</div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
	props: {
		signal: {
			type: Array,
			required: true
		}
	},

	computed: {
		r(): boolean {
			return this.signal[0] as boolean;
		},
		g(): boolean {
			return this.signal[1] as boolean;
		},
		b(): boolean {
			return this.signal[2] as boolean;
		},
	},

	methods: {
		change(color: string) {
			this.$emit('input', [
				color === 'r' ? !this.r : this.r,
				color === 'g' ? !this.g : this.g,
				color === 'b' ? !this.b : this.b,
			]);
		}
	}
});
</script>

<style scoped lang="scss">
.signal-component {
	display: flex;
	
	> *:nth-child(2) {
		margin: 0 8px;
	}
}
</style>
