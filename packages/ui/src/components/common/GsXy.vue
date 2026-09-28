<template>
<div ref="rootEl" :class="$style.root">
	<GsButton :class="$style.open" :primary="gridPadOpened" iconOnly small @click="openGridPad"><i class="ti ti-arrows-move"></i></GsButton>

	<GsInput :class="$style.input" small type="number" :modelValue="value[0]" :min="min" :max="max" :step="step" @update:modelValue="setValue(Number($event), value[1], 'x')">
		<template #prefix>X:</template>
	</GsInput>

	<GsButton v-tooltip="'Lock X:Y ratio'" :class="$style.lock" iconOnly small :primary="lockedRatio != null" @click="lockedRatio != null ? disableRatioLock() : enableRatioLock()"><i class="ti ti-link"></i></GsButton>

	<GsInput :class="$style.input" small type="number" :modelValue="value[1]" :min="min" :max="max" :step="step" @update:modelValue="setValue(value[0], Number($event), 'y')">
		<template #prefix>Y:</template>
	</GsInput>

	<Teleport to="body">
		<XGrid
			v-if="gridPadOpened"
			:modelValue="value"
			:anchorElement="rootEl"
			:lockedRatio="lockedRatio"
			:min="min"
			:max="max"
			@update:modelValue="setValue($event[0], $event[1])"
			@closed="closeGridPad"
			@enableRatioLock="enableRatioLock"
			@disableRatioLock="disableRatioLock"
		/>
	</Teleport>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import GsButton from './GsButton.vue';
import GsInput from './GsInput.vue';
import XGrid from './GsXy.Grid.vue';

const props = withDefaults(defineProps<{
	modelValue: [number, number];
	step?: number;
	logarithmic?: boolean;
	min?: number;
	max: number;
}>(), {
	min: 0,
});

const emit = defineEmits<{
	(ev: 'update:modelValue', value: [number, number]): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished', value: [number, number]): void;
}>();

type AxisLock = 'x' | 'y' | null;

const rootEl = useTemplateRef('rootEl');
const value = ref<[number, number]>([...props.modelValue]);
const axisLock = ref<AxisLock>(null);
const lockedRatio = ref<[number, number] | null>(null);
const gridPadOpened = ref(false);

const useLogarithmic = computed(() => props.logarithmic && props.min > 0 && props.max > props.min);

watch(() => props.modelValue, (newValue) => {
	value.value = [...newValue];
}, { deep: true });

function setValue(x: number, y: number, changedAxis?: 'x' | 'y') {
	const ratio = lockedRatio.value;
	if (ratio == null) {
		value.value = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
	} else {
		const [ratioX, ratioY] = ratio;
		// ポインター位置を比率の直線に射影する。キー操作では指定された軸の値を優先する。
		let scale: number;
		if (changedAxis === 'x') {
			if (ratioX === 0) return;
			scale = x / ratioX;
		} else if (changedAxis === 'y') {
			if (ratioY === 0) return;
			scale = y / ratioY;
		} else if (useLogarithmic.value) {
			// 比率固定は対数座標では傾き1の直線になる。画面上で射影するため、
			// 両軸が要求する倍率の幾何平均を使い、小さい側の操作も等しく反映する。
			scale = Math.sqrt((x / ratioX) * (y / ratioY));
		} else {
			scale = (x * ratioX + y * ratioY) / (ratioX * ratioX + ratioY * ratioY);
			// 両軸を個別に丸めると比率が崩れるため、大きい成分だけをstepに合わせる。
			const dominantComponent = Math.abs(ratioX) >= Math.abs(ratioY) ? ratioX : ratioY;
			scale = (scale * dominantComponent) / dominantComponent;
		}
		// 値を個別にclampせず、両軸が範囲内に収まる共通の倍率を求める。
		let minScale = -Infinity;
		let maxScale = Infinity;
		for (const component of ratio) {
			if (component === 0) continue;
			minScale = Math.max(minScale, Math.min(props.min / component, props.max / component));
			maxScale = Math.min(maxScale, Math.max(props.min / component, props.max / component));
		}
		scale = Math.min(maxScale, Math.max(minScale, scale));
		value.value = [ratioX * scale, ratioY * scale];
		value.value = [Math.round(value.value[0] * 100) / 100, Math.round(value.value[1] * 100) / 100];
	}
	emit('update:modelValue', value.value);
}

function enableRatioLock() {
	if (lockedRatio.value != null) return;

	if (value.value[0] === 0 && value.value[1] === 0) {
		lockedRatio.value = [1, 1];
		axisLock.value = null;
		return;
	}
	const magnitude = Math.max(Math.abs(value.value[0]), Math.abs(value.value[1]));
	// 直接入力などで非正値になっている場合、対数空間で比率を固定できない。
	if (useLogarithmic.value && value.value.some(component => component <= 0)) return;
	if (magnitude === 0) return;
	// 原点を通っても固定時の比率を失わないよう、現在値とは別に保持する。
	lockedRatio.value = [value.value[0] / magnitude, value.value[1] / magnitude];
	axisLock.value = null;
}

function disableRatioLock() {
	lockedRatio.value = null;
}

enableRatioLock();

function openGridPad() {
	if (gridPadOpened.value) return;
	gridPadOpened.value = true;
	// 複数回のドラッグやキー操作も、Gridを閉じるまでひとつの履歴にまとめる。
	emit('beginChanging');
}

function closeGridPad() {
	if (!gridPadOpened.value) return;
	gridPadOpened.value = false;
	emit('changeFinished', value.value);
}

onBeforeUnmount(closeGridPad);

function formatValue(number: number): string {
	if (useLogarithmic.value) return Number(number.toPrecision(5)).toString();
	return Number(number.toFixed(10)).toString();
}
</script>

<style module lang="scss">
.root {
	display: flex;
	gap: 8px;
	width: 100%;
}

.open {
	align-self: center;
}

.input {
	flex: 1;
}

.lock {
	align-self: center;
}
</style>
