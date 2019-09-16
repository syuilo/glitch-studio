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

	data() {
		return {
			r: false,
			g: false,
			b: false
		};
	},

	created() {
		this.r = this.signal[0] as boolean;
		this.g = this.signal[1] as boolean;
		this.b = this.signal[2] as boolean;
	},

	methods: {
		change(color: string) {
			(this as any)[color] = !(this as any)[color];
			this.$emit('input', [
				this.r,
				this.g,
				this.b,
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
