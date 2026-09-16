<template>
<div :class="$style.root">
	<div v-if="type === 'range'">
		<GsRange
			:modelValue="value"
			:step="options.step ?? 1"
			:min="options.min"
			:max="options.max"
			:title="`${options.min} ~ ${options.max}`"
			:continuousUpdate="true"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
		/>
	</div>
	<div v-if="type === 'angle'">
		<GsAngle
			:modelValue="value"
			:step="0.125"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
		/>
	</div>
	<div v-else-if="type === 'range2'">
		<!--<XSlider2 :modelValue="value" :step="options.step ?? 1" :min="options.min" :max="options.max" :title="`${options.min} ~ ${options.max}`" @beginChanging="onBeginChanging" @update:modelValue="changeContinuous" @changeFinished="onFinishChanging"/>-->
	</div>
	<div v-else-if="type === 'number'">
		<GsInput small type="number" :modelValue="value" :min="options.min" :max="options.max" @update:modelValue="changeValue(parseFloat($event, 10))"/>
	</div>
	<div v-else-if="type === 'bool'">
		<GsButton small :primary="value" @click="changeValue(!value)">{{ value ? 'On' : 'Off' }}</GsButton>
	</div>
	<div v-else-if="type === 'enum'">
		<GsSelect small :modelValue="value" :items="options.options" @update:modelValue="v => changeValue(v)"/>
	</div>
	<div v-else-if="type === 'fitMode'">
		<GsSelect
			small
			:modelValue="value"
			:items="[
				{ label: 'Stretch', value: 'stretch' },
				{ label: 'Cover', value: 'cover' },
				{ label: 'Contain', value: 'contain' },
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
	<div v-else-if="type === 'wrapMode'">
		<GsSelect
			small
			:modelValue="value"
			:items="[
				...(options?.canTransparent === true ? [{ label: 'Transparent', value: 'transparent' }] : []),
				{ label: 'Clamp to edge', value: 'clampToEdge' },
				{ label: 'Repeat', value: 'repeat' },
				{ label: 'Repeat (Mirrored)', value: 'repeatMirrored' },
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
	<div v-else-if="type === 'blendMode'">
		<GsSelect
			small
			:modelValue="value"
			:items="[
				{ label: i18n.ts._BlendModes.None, value: 'none' },
				{
					type: 'group',
					label: i18n.ts._BlendModes._Categories.Basic,
					items: [
						{ label: i18n.ts._BlendModes.Normal, value: 'normal' },
					],
				},
				{
					type: 'group',
					label: i18n.ts._BlendModes._Categories.Darken,
					items: [
						{ label: i18n.ts._BlendModes.Darken, value: 'darken' },
						{ label: i18n.ts._BlendModes.Multiply, value: 'multiply' },
						{ label: i18n.ts._BlendModes.ColorBurn, value: 'colorBurn' },
					],
				},
				{
					type: 'group',
					label: i18n.ts._BlendModes._Categories.Lighten,
					items: [
						{ label: i18n.ts._BlendModes.Lighten, value: 'lighten' },
						{ label: i18n.ts._BlendModes.Screen, value: 'screen' },
						{ label: i18n.ts._BlendModes.ColorDodge, value: 'colorDodge' },
						{ label: i18n.ts._BlendModes.Add, value: 'add' },
					],
				},
				{
					type: 'group',
					label: i18n.ts._BlendModes._Categories.Contrast,
					items: [
						{ label: i18n.ts._BlendModes.Overlay, value: 'overlay' },
						{ label: i18n.ts._BlendModes.SoftLight, value: 'softLight' },
						{ label: i18n.ts._BlendModes.HardLight, value: 'hardLight' },
					],
				},
				{
					type: 'group',
					label: i18n.ts._BlendModes._Categories.Comparative,
					items: [
						{ label: i18n.ts._BlendModes.Difference, value: 'difference' },
						{ label: i18n.ts._BlendModes.Exclusion, value: 'exclusion' },
						{ label: i18n.ts._BlendModes.Subtract, value: 'subtract' },
					],
				},
				{
					type: 'group',
					label: i18n.ts._BlendModes._Categories.Hsl,
					items: [
						{ label: i18n.ts._BlendModes.Hue, value: 'hue' },
						{ label: i18n.ts._BlendModes.Saturation, value: 'saturation' },
						{ label: i18n.ts._BlendModes.Color, value: 'color' },
						{ label: i18n.ts._BlendModes.Luminosity, value: 'luminosity' },
					],
				},
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
	<div v-else-if="type === 'signal'">
		<GsSignal :signal="value" @input="changeValue($event)"/>
	</div>
	<div v-else-if="type === 'xy'">
		<GsXy :modelValue="value" :step="options.step ?? 0.1" :min="options.min" :max="options.max" @beginChanging="onBeginChanging" @update:modelValue="v => changeContinuous(v)" @changeFinished="onFinishChanging"/>
	</div>
	<div v-else-if="type === 'wh'">
		<XXySlider :modelValue="value" :step="options.step ?? 0.1" :min="options.min" :max="options.max" @update:modelValue="v => changeValue(v)"/>
	</div>
	<div v-else-if="type === 'vector'" style="max-width: 150px;">
		<GsXy :modelValue="value" :step="options.step ?? 0.1" :min="options.min" :max="options.max" @beginChanging="onBeginChanging" @update:modelValue="v => changeContinuous(v)" @changeFinished="onFinishChanging"/>
	</div>
	<div v-else-if="type === 'color'">
		<GsColorInput
			:modelValue="normalizeColor(value)"
			:title="title"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
		/>
	</div>
	<div v-else-if="type === 'seed'" class="seed">
		<input type="number" :value="value" @change="changeValue(parseInt($event.target.value, 10))"/><button :title="i18n.ts.Random" @click="() => changeValue(Math.floor(Math.random() * 16384))"><i class="ti ti-dice-5"></i></button>
	</div>
	<div v-else-if="type === 'time'" class="time">
		<input type="number" :value="value" @change="changeValue(parseInt($event.target.value, 10))"/><button :title="i18n.ts.Random" @click="() => changeValue(Math.floor(Math.random() * 16384))"><i class="ti ti-dice-5"></i></button>
	</div>
	<div v-else-if="type === 'node'" style="display: flex;">
		<div ref="portEl">・</div>
		<i v-if="hasTypeMismatch" v-tooltip="'Data type mismatch'" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
		<GsSelect
			small
			style="flex: 1; min-width: 0;"
			:modelValue="nodeOutputKey(value)"
			:items="[{ label: i18n.ts.None, value: null }, ...nodeOutputItems]"
			@update:modelValue="key => changeValue(nodeOutputItems.find(item => item.value === key)?.connection ?? null)"
		/>
	</div>
	<div v-else-if="type === 'nodes' && node">
		<XNodesInput :modelValue="value" :node="node" :group="group" :name="name" :dataType="inputDataType" @update:modelValue="v => changeValue(v)"/>
	</div>
	<div v-else-if="type === 'image'">
		<GsSelect
			small
			:modelValue="value"
			:items="[
				{ label: i18n.ts.None, value: null },
				...(appContext.state.assets.value.length > 0 ? [{
					type: 'group' as const,
					label: 'Assets',
					items: appContext.state.assets.value.filter(asset => asset.fileDataType.startsWith('image/')).map(asset => ({ label: asset.name, value: asset.id })),
				}] : []),
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
	<div v-else-if="type === 'player'">
		<GsSelect
			small
			:modelValue="value"
			:items="[
				{ label: i18n.ts.None, value: null },
				...(appContext.state.players.value.length > 0 ? [{
					type: 'group' as const,
					label: 'Players',
					items: appContext.state.players.value.map(player => ({ label: player.name, value: player.id })),
				}] : []),
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, watchEffect, shallowRef } from 'vue';
import { getNodeInputDataType } from '@glitch/shared/utility/node-outputs.ts';
import GsSignal from './common/GsSignal.vue';
import GsXy from './common/GsXy.vue';
import XXySlider from './common/xy-slider.vue';
import GsColorInput from './common/GsColorInput.vue';
import GsInput from './common/GsInput.vue';
import GsRange from './common/GsRange.vue';
import GsAngle from './common/GsAngle.vue';
import XNodesInput from './nodes-input.vue';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import GsVideoControls from './common/GsVideoControls.vue';
import type { GsGroupNode, GsNode } from '@glitch/shared/types.ts';
import { i18n } from '@/i18n.ts';
import { appContext, engine, wireMap } from '@/app.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey } from '@/utility/node-outputs.ts';
import { normalizeColor } from '@/utility/color-input.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';

const props = defineProps<{
	type: string;
	value: any;
	options?: any;
	node?: GsNode;
	group?: GsGroupNode | null;
	name?: string;
	title?: string;
}>();

const emit = defineEmits<{
	(ev: 'input', value: any): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
	(ev: 'changeContinuous', value: any): void;
}>();

const portEl = shallowRef<HTMLElement>();
const inputDataType = computed(() => getNodeInputDataType({ ...props.options, type: props.options?.type ?? props.type }));
const nodeOutputItems = computed(() => getNodeOutputItems(appContext.state.nodes.value, props.node?.id, inputDataType.value));
const hasTypeMismatch = computed(() => props.type === 'node' && hasNodeInputTypeMismatch(appContext.state.nodes.value, props.value, inputDataType.value));

function changeValue(value: any) {
	emit('input', value);
}

function onBeginChanging() {
	emit('beginChanging');
}

function changeContinuous(value: any) {
	emit('changeContinuous', value);
}

function onFinishChanging() {
	emit('changeFinished');
}

watchEffect(onCleanup => {
	const el = portEl.value;
	if (el == null) return;
	// 描画上の接続点はポートに保ち、ドロップはラベルを含む行全体で受け付ける。
	const row = el.closest<HTMLElement>('[data-wire-input-row]') ?? el.parentElement ?? el;
	onCleanup(registerWireInput(row, changeValue,
		connection => nodeOutputItems.value.find(item => item.value === nodeOutputKey(connection))?.typeCompatible ?? null));
});

watchEffect(onCleanup => {
	const el = portEl.value;
	const nodeId = props.node?.id;
	const name = props.name;
	if (el == null || nodeId == null || name == null) return;
	if (wireMap.in[nodeId] == null) wireMap.in[nodeId] = {};
	wireMap.in[nodeId][name] = el;
	onCleanup(() => {
		if (wireMap.in[nodeId]?.[name] === el) delete wireMap.in[nodeId][name];
	});
});
</script>

<style module lang="scss">
.root {
}

.typeWarning {
	align-self: center;
	margin-right: 6px;
	color: var(--THEME-warn);
}

.seed {
	display: flex;
}

.seedButton {
	width: 38px;
	height: 25px;
	margin-left: 6px;
}

.player {
	margin-top: 8px;
}
</style>
