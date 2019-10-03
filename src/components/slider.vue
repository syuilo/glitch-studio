<template>
<div class="slider-component">
	<div class="indicator" ref="indicator"></div>
	<input type="range"
		:value="value"
		:step="step || 1"
		:min="min"
		:max="max"
		:title="`${min} ~ ${max}`"
		@input="onInput(parseFloat($event.target.value, 10))"
		@change="$emit('change', parseFloat($event.target.value, 10))"/>
</div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
	props: {
		value: {
			type: Number,
			required: true
		},

		step: {
			type: Number,
			required: false
		},

		min: {
			type: Number,
			required: true
		},

		max: {
			type: Number,
			required: true
		}
	},

	mounted() {
		(this.$refs.indicator as HTMLElement).style.width = ((this.value - this.min) / (this.max - this.min) * 100) + '%';
	},

	methods: {
		onInput(v: number) {
			(this.$refs.indicator as HTMLElement).style.width = ((v - this.min) / (this.max - this.min) * 100) + '%';
			this.$emit('input', v);
		}
	}
});
</script>

<style scoped lang="scss">
.slider-component {
	position: relative;

	.indicator {
		position: absolute;
		top: 11px;
		left: 0;
		height: 2px;
		background: #bb6100;
		border-radius: 2px;
		pointer-events: none;
	}
}
</style>
