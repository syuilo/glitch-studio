<template>
<div class="control-component">
	<div v-if="type === 'range'">
		<input type="range" :value="value" :step="options.step || 1" :min="options.min" :max="options.max" :title="`${options.min} ~ ${options.max}`" @change="changeValue(parseFloat($event.target.value, 10))"/>
	</div>
	<div v-else-if="type === 'number'">
		<input type="number" :value="value" :min="options.min" :max="options.max" @change="changeValue(parseFloat($event.target.value, 10))"/>
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
			<option value="none">{{ $t('_BlendModes.None') }}</option>
			<optgroup :label="$t('_BlendModes._Categories.Basic')">
				<option value="normal">{{ $t('_BlendModes.Normal') }}</option>
			</optgroup>
			<optgroup :label="$t('_BlendModes._Categories.Darken')">
				<option value="darken">{{ $t('_BlendModes.Darken') }}</option>
				<option value="multiply">{{ $t('_BlendModes.Multiply') }}</option>
				<option value="colorBurn">{{ $t('_BlendModes.ColorBurn') }}</option>
			</optgroup>
			<optgroup :label="$t('_BlendModes._Categories.Lighten')">
				<option value="lighten">{{ $t('_BlendModes.Lighten') }}</option>
				<option value="screen">{{ $t('_BlendModes.Screen') }}</option>
				<option value="colorDodge">{{ $t('_BlendModes.ColorDodge') }}</option>
			</optgroup>
			<optgroup :label="$t('_BlendModes._Categories.Contrast')">
				<option value="overlay">{{ $t('_BlendModes.Overlay') }}</option>
				<option value="softLight">{{ $t('_BlendModes.SoftLight') }}</option>
				<option value="hardLight">{{ $t('_BlendModes.HardLight') }}</option>
			</optgroup>
			<optgroup :label="$t('_BlendModes._Categories.Comparative')">
				<option value="difference">{{ $t('_BlendModes.Difference') }}</option>
				<option value="exclusion">{{ $t('_BlendModes.Exclusion') }}</option>
			</optgroup>
			<optgroup :label="$t('_BlendModes._Categories.Hsl')">
				<option value="hue">{{ $t('_BlendModes.Hue') }}</option>
				<option value="saturation">{{ $t('_BlendModes.Saturation') }}</option>
				<option value="color">{{ $t('_BlendModes.Color') }}</option>
				<option value="luminosity">{{ $t('_BlendModes.Luminosity') }}</option>
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
	<div v-else-if="type === 'seed'" class="seed">
		<input type="number" :value="value" @change="changeValue(parseInt($event.target.value, 10))"/><button title="Random" @click="() => changeValue(Math.floor(Math.random() * 16384))"><fa :icon="faRandom"/></button>
	</div>
	<div v-else-if="type === 'image'">
		<select :value="value" @change="changeValue($event.target.value)">
			<option :value="null">None</option>
			<optgroup label="Assets" v-if="$store.state.assets.length > 0">
				<option v-for="asset in $store.state.assets" :value="asset.id" :key="asset.id">{{ asset.name }}</option>
			</optgroup>
		</select>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import { faRandom } from '@fortawesome/free-solid-svg-icons';
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

	data() {
		return {
			faRandom
		};
	},

	methods: {
		changeValue(value: any) {
			this.$emit('input', value);
		},
	}
});
</script>

<style scoped lang="scss">
.control-component {
	> .seed {
		display: flex;

		> button {
			width: 38px;
			height: 25px;
			margin-left: 6px;
		}
	}
}
</style>
