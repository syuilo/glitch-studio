<template>
<div :class="$style.root">
	<div :class="$style.direction" :title="formatAngle(modelValue)">
		<div :class="$style.needle" :style="{ transform: `rotate(${modelValue * 180}deg)` }"></div>
	</div>
	<div :class="$style.control">
		<GsRange
			:modelValue="modelValue"
			:min="-1"
			:max="1"
			:step="step"
			:textConverter="formatAngle"
			:continuousUpdate="true"
			@beginChanging="emit('beginChanging')"
			@update:modelValue="emit('update:modelValue', $event)"
			@changeFinished="emit('changeFinished')"
		/>
		<div :class="$style.value">{{ formatAngle(modelValue) }}</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import GsRange from './GsRange.vue';

withDefaults(defineProps<{
	modelValue: number;
	step?: number;
}>(), { step: 0.001 });

const emit = defineEmits<{
	(ev: 'update:modelValue', value: number): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
}>();

function formatAngle(value: number): string {
	return `${Math.round(value * 1000) / 1000} (${Math.round(value * 1800) / 10}°)`;
}
</script>

<style module>
.root {
	display: flex;
	align-items: center;
	gap: 10px;
}

.direction {
	position: relative;
	flex: 0 0 28px;
	height: 28px;
	border: 1px solid var(--THEME-divider);
	border-radius: 50%;
}

.needle {
	position: absolute;
	left: 50%;
	top: calc(50% - 1px);
	width: 11px;
	height: 2px;
	background: var(--THEME-accent);
	transform-origin: left center;
}

.control {
	flex: 1;
	min-width: 0;
}

.value {
	text-align: right;
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;
	opacity: 0.7;
}
</style>
