<template>
<div class="control-component">
	<div v-if="type === 'range'">
		<input type="range" :value="value" step="1" :min="options.min" :max="options.max" @change="changeValue(parseInt($event.target.value, 10))"/>
	</div>
	<div v-else-if="type === 'number'">
		<input type="number" :value="value" @change="changeValue(parseInt($event.target.value, 10))"/>
	</div>
	<div v-else-if="type === 'bool'">
		<button @click="changeValue(!value)" :class="{ primary: value }">{{ value ? 'On' : 'Off' }}</button>
	</div>
	<div v-else-if="type === 'enum'">
		<select :value="value" @change="changeValue($event.target.value)">
			<option v-for="o in options.options" :value="o.value" :key="o.value">{{ o.label }}</option>
		</select>
	</div>
	<div v-else-if="type === 'blendMode'">
		<select :value="value" @change="changeValue($event.target.value)">
			<option value="none">None</option>
			<optgroup label="Normal">
				<option value="normal">Normal</option>
			</optgroup>
			<optgroup label="Darken">
				<option value="darken">Darken</option>
				<option value="multiply">Multiply</option>
				<option value="colorBurn">Color Burn</option>
			</optgroup>
			<optgroup label="Lighten">
				<option value="lighten">Lighten</option>
				<option value="screen">Screen</option>
				<option value="colorDodge">Color Dodge</option>
			</optgroup>
			<optgroup label="Contrast">
				<option value="overlay">Overlay</option>
				<option value="softLight">Soft Light</option>
				<option value="hardLight">Hard Light</option>
			</optgroup>
			<optgroup label="Inversion">
				<option value="difference">Difference</option>
				<option value="exclusion">Exclusion</option>
			</optgroup>
			<optgroup label="Component">
				<option value="hue">Hue</option>
				<option value="saturation">Saturation</option>
				<option value="color">Color</option>
				<option value="luminosity">Luminosity</option>
			</optgroup>
		</select>
	</div>
	<div v-else-if="type === 'signal'">
		<XSignal :signal="value" @input="changeValue($event)"/>
	</div>
	<div v-else-if="type === 'xy'">
		<XXy :xy="value" @input="changeValue($event)"/>
	</div>
	<div v-else-if="type === 'wh'">
		<XWh :wh="value" @input="changeValue($event)"/>
	</div>
	<div v-else-if="type === 'color'">
		<XColor :color="value" @input="changeValue($event)"/>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import XSignal from './signal.vue';
import XXy from './xy.vue';
import XWh from './wh.vue';
import XColor from './color.vue';
import { fxs } from '../glitch/fxs';

export default Vue.extend({
	components: {
		XSignal, XXy, XWh, XColor
	},

	props: {
		type: {
			required: true
		},
		value: {
			required: true
		},
		options: {
			required: false
		},
	},

	methods: {
		changeValue(value: any) {
			this.$emit('input', value);
		},
	}
});
</script>

<style scoped lang="scss">
</style>
