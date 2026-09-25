<template>
<div :class="$style.root">
	<div v-if="directEditMode" :class="$style.directEditForm">
		<GsInput v-model="tempValueForDirectEdit" small :class="$style.directEditFormInput" @enter="finishDirectEdit"/>
		<GsButton small iconOnly primary @click="finishDirectEdit"><i class="ti ti-check"></i></GsButton>
		<GsButton small iconOnly @click="directEditMode = false"><i class="ti ti-x"></i></GsButton>
	</div>
	<div v-else-if="def.ui.control === 'range'">
		<GsRange
			v-if="value >= def.ui.min && value <= def.ui.max"
			:modelValue="value"
			:step="def.ui.step ?? 1"
			:min="def.ui.min"
			:max="def.ui.max ?? 1"
			:title="`${def.ui.min} ~ ${def.ui.max}`"
			:continuousUpdate="true"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
			@thumbDoubleClicked="reset"
		/>
		<GsInput v-else small type="number" :modelValue="value" @update:modelValue="changeValue(Number($event))"/>
	</div>
	<div v-else-if="def.ui.control === 'angle'">
		<GsAngle
			:modelValue="value"
			:step="def.ui.step ?? 0.125"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
		/>
	</div>
	<div v-else-if="def.ui.control === 'number'">
		<GsInput small type="number" :modelValue="value" :min="def.ui.min" :max="def.ui.max" @update:modelValue="changeValue(Number($event))"/>
	</div>
	<div v-else-if="def.ui.control === 'bool'">
		<GsButton small :primary="value" @click="changeValue(!value)">{{ value ? 'On' : 'Off' }}</GsButton>
	</div>
	<div v-else-if="def.ui.control === 'enum'">
		<GsSelect small :modelValue="value" :items="('options' in def ? [...def.options] : [])" @update:modelValue="v => changeValue(v)"/>
	</div>
	<div v-else-if="def.ui.control === 'fitMode'">
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
	<div v-else-if="def.ui.control === 'wrapMode'">
		<GsSelect
			small
			:modelValue="value"
			:items="[
				{ label: 'Transparent', value: 'transparent' },
				{ label: 'Clamp', value: 'clamp' },
				{ label: 'Repeat', value: 'repeat' },
				{ label: 'Repeat (Mirrored)', value: 'repeatMirrored' },
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
	<div v-else-if="def.ui.control === 'blendMode'">
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
	<div v-else-if="def.ui.control === 'xy'">
		<GsXy :modelValue="value" :step="def.ui.step ?? 0.1" :min="def.ui.min" :max="def.ui.max ?? 1" @beginChanging="onBeginChanging" @update:modelValue="v => changeContinuous(v)" @changeFinished="onFinishChanging"/>
	</div>
	<div v-else-if="def.ui.control === 'wh'">
		<GsXy :modelValue="value" :step="def.ui.step ?? 0.1" :min="def.ui.min" :max="def.ui.max ?? 1" @beginChanging="onBeginChanging" @update:modelValue="v => changeContinuous(v)" @changeFinished="onFinishChanging"/>
	</div>
	<div v-else-if="def.ui.control === 'vector'" style="max-width: 150px;">
		<GsXy :modelValue="value" :step="def.ui.step ?? 0.1" :min="def.ui.min" :max="def.ui.max ?? 1" @beginChanging="onBeginChanging" @update:modelValue="v => changeContinuous(v)" @changeFinished="onFinishChanging"/>
	</div>
	<div v-else-if="def.ui.control === 'color'">
		<GsColorInput
			:modelValue="normalizeColor(value)"
			:title="title"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
		/>
	</div>
	<div v-else-if="def.ui.control === 'seed'" style="display: flex;">
		<GsInput style="flex: 1;" type="number" :modelValue="value" @update:modelValue="changeValue(parseInt(String($event), 10))"/>
		<GsButton small iconOnly :title="i18n.ts.Random" @click="() => changeValue(Math.floor(Math.random() * 16384))"><i class="ti ti-dice-5"></i></GsButton>
	</div>
	<div v-else-if="def.ui.control === 'image' || def.ui.control === 'videoAsset'">
		<GsSelect
			small
			:modelValue="value"
			:items="[
				{ label: i18n.ts.None, value: null },
				...(appContext.state.assets.value.length > 0 ? [{
					type: 'group' as const,
					label: 'Assets',
					items: appContext.state.assets.value.filter(asset => asset.fileDataType.startsWith(def.ui.control === 'videoAsset' ? 'video/' : 'image/')).map(asset => ({ label: asset.name, value: asset.id })),
				}] : []),
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
	<div v-else-if="def.ui.control === 'player'">
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
import { computed, watchEffect, shallowRef, ref } from 'vue';
import GsXy from './common/GsXy.vue';
import GsColorInput from './common/GsColorInput.vue';
import GsInput from './common/GsInput.vue';
import GsRange from './common/GsRange.vue';
import GsAngle from './common/GsAngle.vue';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import type { ParameterDefinition } from '@glitch/shared/parameter.ts';
import { i18n } from '@/i18n.ts';
import { appContext, wireMap } from '@/app.ts';
import { normalizeColor } from '@/utility/color-input.ts';

const props = defineProps<{
	def: ParameterDefinition;
	value: any;
	title?: string;
}>();

const emit = defineEmits<{
	(ev: 'input', value: any): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
	(ev: 'changeContinuous', value: any): void;
	(ev: 'reset'): void;
}>();

const directEditMode = ref(false);

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

function reset() {
	emit('reset');
}

const tempValueForDirectEdit = ref('');

function directEdit() {
	tempValueForDirectEdit.value = JSON.stringify(props.value);
	directEditMode.value = true;
}

function finishDirectEdit() {
	// TODO: 値がパースできるか・できたとして妥当かどうか(真理値パラメータなのに数値になっていないかなど)のバリデーションを追加
	// なお、数値のmin/max指定など"型"以外のバリデーションは行わない(範囲外の値を強制設定したいときのためという目的も兼ねているので)
	changeValue(JSON.parse(tempValueForDirectEdit.value));
	directEditMode.value = false;
}

defineExpose({
	directEdit,
});
</script>

<style module lang="scss">
.root {
}

.seed {
	display: flex;
}

.seedButton {
	width: 38px;
	height: 25px;
	margin-left: 6px;
}

.directEditForm {
	display: flex;
	align-items: center;
	gap: 8px;
}

.directEditFormInput {
	flex: 1;
}
</style>
