<template>
<div class="control-component">
	<div v-if="type === 'range'">
		<input type="number" :value="value" step="1" @change="changeValue(parseInt($event.target.value, 10))"/>
	</div>
	<div v-else-if="type === 'number'">
		<input type="number" :value="value" @change="changeValue(parseInt($event.target.value, 10))"/>
	</div>
	<div v-else-if="type === 'bool'">
		<button @click="changeValue(!value)" :class="{ primary: value }">{{ value ? 'On' : 'Off' }}</button>
	</div>
	<div v-else-if="type === 'enum'">
		<select :value="value" @change="changeValue($event.target.value)">
			<option v-for="o in paramDefs[param].options" :value="o" :key="o">{{ decamelize(o) }}</option>
		</select>
	</div>
	<div v-else-if="type === 'blendMode'">
		<select :value="value" @change="changeValue($event.target.value)">
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
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import XSignal from './signal.vue';
import { fxs } from '../glitch/fxs';
import { ParamDefs } from '../glitch/core';

export default Vue.extend({
	components: {
		XSignal
	},

	props: {
		type: {
			required: true
		},
		value: {
			required: true
		}
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
