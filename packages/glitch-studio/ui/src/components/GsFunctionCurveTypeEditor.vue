<template>
<div :class="$style.root">
	<GsSelect
		data-test-function-curve-type
		:modelValue="curve.type"
		:items="typeItems"
		@update:modelValue="setType"
	>
		<template #label>{{ i18n.ts._FunctionCurve.CurveType }}</template>
	</GsSelect>
	<template v-if="curve.type === 'easing'">
		<GsSelect
			:modelValue="curve.family"
			:items="familyItems"
			@update:modelValue="setEasingFamily"
		>
			<template #label>{{ i18n.ts._FunctionCurve.EasingFamily }}</template>
		</GsSelect>
		<GsSelect
			:modelValue="curve.direction"
			:items="directionItems"
			@update:modelValue="setEasingDirection"
		>
			<template #label>{{ i18n.ts._TimelineKeyframe.EasingDirection }}</template>
		</GsSelect>
	</template>
	<GsInput
		v-else-if="curve.type === 'pulse'"
		data-test-function-curve-numeric-setting
		type="number"
		manualSave
		validateNumberBounds
		:min="0"
		:max="1"
		:step="0.01"
		:modelValue="curve.dutyCycle"
		@update:modelValue="dutyCycle => emit('change', { type: 'pulse', dutyCycle })"
	>
		<template #label>{{ i18n.ts._FunctionCurve.DutyCycle }}</template>
	</GsInput>
	<GsInput
		v-else-if="curve.type === 'steps'"
		data-test-function-curve-numeric-setting
		type="number"
		manualSave
		validateNumberBounds
		:validateNumericValue="Number.isSafeInteger"
		:min="2"
		:max="Number.MAX_SAFE_INTEGER"
		:step="1"
		:modelValue="curve.levelCount"
		@update:modelValue="levelCount => emit('change', { type: 'steps', levelCount })"
	>
		<template #label>{{ i18n.ts._FunctionCurve.LevelCount }}</template>
	</GsInput>
	<GsInput
		v-else-if="curve.type === 'deadZone'"
		data-test-function-curve-numeric-setting
		type="number"
		manualSave
		validateNumberBounds
		:min="0"
		:max="1"
		:step="0.01"
		:modelValue="curve.deadZoneWidth"
		@update:modelValue="deadZoneWidth => emit('change', { type: 'deadZone', deadZoneWidth })"
	>
		<template #label>{{ i18n.ts._FunctionCurve.DeadZoneWidth }}</template>
	</GsInput>
</div>
</template>

<script lang="ts" setup>
import { EASING_DIRECTIONS, EASING_FAMILIES } from '@gs/shared/easing.ts';
import type { EasingDirection, EasingFamily } from '@gs/shared/easing.ts';
import type { FunctionCurve } from '@gs/shared/function-curve/function-curve.ts';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import type { GsSelectItem } from './common/GsSelect.vue';
import { i18n } from '@/i18n.ts';
import { createFunctionCurve } from '@/utility/curve-animation.ts';

const props = defineProps<{ curve: FunctionCurve }>();
const emit = defineEmits<{ change: [curve: FunctionCurve] }>();

const labels = i18n.ts._FunctionCurve;
const typeItems: GsSelectItem<FunctionCurve['type']>[] = [
	{ label: labels.Bezier, value: 'bezier' },
	{ label: labels.Linear, value: 'linear' },
	{ label: labels.Smoothstep, value: 'smoothstep' },
	{ label: labels.Smootherstep, value: 'smootherstep' },
	{ label: labels.Easing, value: 'easing' },
	{ label: labels.SmoothPulse, value: 'smoothPulse' },
	{ label: labels.Pulse, value: 'pulse' },
	{ label: labels.Steps, value: 'steps' },
	{ label: labels.SineWave, value: 'sineWave' },
	{ label: labels.DeadZone, value: 'deadZone' },
];
const familyItems = EASING_FAMILIES.map(family => ({ label: family[0].toUpperCase() + family.slice(1), value: family }));
const directionLabels: Record<EasingDirection, string> = { in: 'In', out: 'Out', inOut: 'InOut' };
const directionItems = EASING_DIRECTIONS.map(direction => ({ label: directionLabels[direction], value: direction }));

function setType(type: FunctionCurve['type']) {
	if (type !== props.curve.type) emit('change', createFunctionCurve(type));
}

function setEasingFamily(family: EasingFamily) {
	if (props.curve.type === 'easing') emit('change', { ...props.curve, family });
}

function setEasingDirection(direction: EasingDirection) {
	if (props.curve.type === 'easing') emit('change', { ...props.curve, direction });
}
</script>

<style lang="scss" module>
.root {
	display: grid;
	gap: 8px;
}
</style>
