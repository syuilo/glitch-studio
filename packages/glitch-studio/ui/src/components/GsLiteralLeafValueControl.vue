<template>
<div :class="$style.root">
	<div v-if="directEditMode" :class="$style.directEditForm">
		<GsInput v-model="tempValueForDirectEdit" :class="$style.directEditFormInput" @enter="finishDirectEdit"/>
		<GsButton iconOnly primary icon="ti ti-check" @click="finishDirectEdit"/>
		<GsButton iconOnly icon="ti ti-x" @click="directEditMode = false"/>
	</div>
	<div v-else-if="scalarControl?.controlType === 'range'">
		<GsRange
			v-if="value >= scalarControl.min && value <= scalarControl.max"
			:modelValue="value"
			:step="scalarControl.step ?? 1"
			:logarithmic="scalarControl.logarithmic"
			:min="scalarControl.min"
			:max="scalarControl.max ?? 1"
			:title="`${scalarControl.min} ~ ${scalarControl.max}`"
			:continuousUpdate="true"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
			@thumbDoubleClicked="reset"
		/>
		<GsInput v-else type="number" :modelValue="value" @focusin="onBeginChanging" @update:modelValue="changeContinuous(Number($event))" @focusout="onFinishChanging"/>
	</div>
	<div v-else-if="scalarControl?.controlType === 'angle'">
		<GsAngle
			:modelValue="value"
			:step="scalarControl.step ?? 0.125"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
		/>
	</div>
	<div v-else-if="scalarControl?.controlType === 'number'">
		<GsInput type="number" :modelValue="value" :min="scalarControl.min" :max="scalarControl.max" @focusin="onBeginChanging" @update:modelValue="changeContinuous(Number($event))" @focusout="onFinishChanging"/>
	</div>
	<div v-else-if="dataType.kind === 'bool'">
		<GsButton :primary="value" @click="changeValue(!value)">{{ value ? i18n.ts.On : i18n.ts.Off }}</GsButton>
	</div>
	<div v-else-if="dataType.kind === 'string'">
		<GsTextarea
			:modelValue="value"
			@focusin="onBeginChanging"
			@update:modelValue="changeContinuous"
			@focusout="onFinishChanging"
		/>
	</div>
	<div v-else-if="dataType.kind === 'enum'">
		<GsSelect :modelValue="value" :items="enumItems" @update:modelValue="v => changeValue(v)"/>
		<div v-if="typeof value !== 'string' || !dataType.options.includes(value)" :class="$style.enumError">
			{{ i18n.t('_CustomParameterInput.InvalidEnumValue', { value: JSON.stringify(value) ?? String(value) }) }}
		</div>
	</div>
	<div v-else-if="dataType.kind === 'fitMode'">
		<GsSelect
			:modelValue="value"
			:items="[
				{ label: i18n.ts._FitModes.stretch, value: 'stretch' },
				{ label: i18n.ts._FitModes.cover, value: 'cover' },
				{ label: i18n.ts._FitModes.contain, value: 'contain' },
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
	<div v-else-if="dataType.kind === 'wrapMode'">
		<GsSelect
			:modelValue="value"
			:items="[
				{ label: i18n.ts._WrapModes.transparent, value: 'transparent' },
				{ label: i18n.ts._WrapModes.clamp, value: 'clamp' },
				{ label: i18n.ts._WrapModes.repeat, value: 'repeat' },
				{ label: i18n.ts._WrapModes.repeatMirrored, value: 'repeatMirrored' },
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
	<div v-else-if="dataType.kind === 'blendMode'">
		<GsSelect
			:modelValue="value"
			:items="[
				{ label: i18n.ts._BlendModes.None, value: 'none' },
				{
					type: 'group',
					label: i18n.ts._BlendModes._Categories.Basic,
					items: [
						{ label: i18n.ts._BlendModes.Normal, value: 'normal' },
						{ label: i18n.ts._BlendModes.Replace, value: 'replace' },
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
						{ label: i18n.ts._BlendModes.Emission, value: 'emission' },
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
	<div v-else-if="vectorControl?.controlType === 'xy'">
		<GsXy :enableRatioLock="false" :modelValue="value" :logarithmic="vectorControl.logarithmic" :step="vectorControl.step ?? 0.1" :min="vectorControl.min" :max="vectorControl.max ?? 1" @beginChanging="onBeginChanging" @update:modelValue="v => changeContinuous(v)" @changeFinished="onFinishChanging"/>
	</div>
	<div v-else-if="vectorControl?.controlType === 'dimension'">
		<GsXy :enableRatioLock="true" :modelValue="value" :logarithmic="vectorControl.logarithmic" :step="vectorControl.step ?? 0.1" :min="vectorControl.min" :max="vectorControl.max ?? 1" @beginChanging="onBeginChanging" @update:modelValue="v => changeContinuous(v)" @changeFinished="onFinishChanging"/>
	</div>
	<div v-else-if="vectorControl?.controlType === 'vector'">
		<GsXy :enableRatioLock="false" :modelValue="value" :logarithmic="vectorControl.logarithmic" :step="vectorControl.step ?? 0.1" :min="vectorControl.min" :max="vectorControl.max ?? 1" @beginChanging="onBeginChanging" @update:modelValue="v => changeContinuous(v)" @changeFinished="onFinishChanging"/>
	</div>
	<div v-else-if="dataType.kind === 'color'" :class="$style.colorControl">
		<GsSignal
			v-if="colorControl?.controlType === 'signal'"
			:signal="[value[0] > 0, value[1] > 0, value[2] > 0]"
			@input="changeSignal"
		/>
		<GsColorInput
			:modelValue="normalizeColor(value)"
			:title="title"
			@beginChanging="onBeginChanging"
			@update:modelValue="changeContinuous"
			@changeFinished="onFinishChanging"
		/>
	</div>
	<div v-else-if="scalarControl?.controlType === 'seed'" style="display: flex;">
		<GsInput large style="flex: 1;" type="number" :modelValue="value" @focusin="onBeginChanging" @update:modelValue="changeContinuous(parseInt(String($event), 10))" @focusout="onFinishChanging"/>
		<GsButton iconOnly :title="i18n.ts.Random" icon="ti ti-dice-5" @click="() => changeValue(Math.floor(Math.random() * 16384))"/>
	</div>
	<div v-else-if="dataType.kind === 'imageAssetTextureReference' || dataType.kind === 'assetReference'" :class="$style.assetControl">
		<GsButton :class="$style.assetButton" @click="chooseAsset">{{ selectedAsset?.name ?? (value == null ? `${i18n.ts._Assets.SelectButton}...` : i18n.ts._Assets.Missing) }}</GsButton>
		<GsButton v-if="value != null" iconOnly :title="i18n.ts.None" icon="ti ti-x" @click="changeValue(null)"/>
	</div>
	<div v-else-if="dataType.kind === 'audioSource'">
		<GsSelect :modelValue="value?.playerId ?? null" :items="[{ label: i18n.ts.None, value: null }, ...stateManager.state.players.value.map(player => ({ label: player.name, value: player.id }))]" @update:modelValue="v => changeValue(v == null ? null : { type: 'player', playerId: v })"/>
	</div>
	<div v-else-if="dataType.kind === 'playerReference'">
		<GsSelect
			:modelValue="value"
			:items="[
				{ label: i18n.ts.None, value: null },
				...(stateManager.state.players.value.length > 0 ? [{
					type: 'group' as const,
					label: i18n.ts.Players,
					items: stateManager.state.players.value.map(player => ({ label: player.name, value: player.id })),
				}] : []),
			]"
			@update:modelValue="v => changeValue(v)"
		/>
	</div>
</div>
</template>

<script lang="ts" setup generic="T extends LeafDataType">
import { getAssetReferenceMimeType } from '@gs/shared/data-type/asset-reference.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { computed, onBeforeUnmount, ref } from 'vue';
import GsXy from './common/GsXy.vue';
import GsColorInput from './common/GsColorInput.vue';
import GsSignal from './common/GsSignal.vue';
import GsInput from './common/GsInput.vue';
import GsTextarea from './common/GsTextarea.vue';
import GsRange from './common/GsRange.vue';
import GsAngle from './common/GsAngle.vue';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import type { DataTypeUiControlDefinitionMap, DataTypeUiDefinition } from '@gs/shared/data-type/data-type-ui.ts';
import type { LeafDataType } from '@gs/shared/data-type/data-type.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import { normalizeColor } from '@/utility/color-input.ts';
import { selectAsset } from '@/ui.ts';

const { stateManager } = appContext.projectContext;

const props = defineProps<{
	// コンテナの子や配列操作は呼び出し元が扱い、このコントロールには末端の定義だけを渡す。
	dataType: T;
	control: DataTypeUiDefinition<NoInfer<T>>;
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

// ジェネリックなdataTypeの絞り込みは別propのcontrolへ伝播しないため、
// 型とコントロールの対応が保証されたpropsを、種類の確認後に取り出す。
const scalarControl = computed(() => props.dataType.kind === 'scalar'
	? props.control as DataTypeUiControlDefinitionMap['scalar']
	: null);
const vectorControl = computed(() => props.dataType.kind === 'vector'
	? props.control as DataTypeUiControlDefinitionMap['vector']
	: null);
const colorControl = computed(() => props.dataType.kind === 'color'
	? props.control as DataTypeUiControlDefinitionMap['color']
	: null);
const enumItems = computed(() => {
	if (props.dataType.kind !== 'enum') return [];
	const control = props.control as DataTypeUiControlDefinitionMap['enum'];
	return props.dataType.options.map(value => ({ value, label: control.labels[value] ?? value }));
});

const directEditMode = ref(false);
const selectedAsset = computed(() => stateManager.state.assets.value.find(asset => asset.id === props.value) ?? null);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

async function chooseAsset() {
	const dataType = props.dataType;
	if (dataType.kind !== 'imageAssetTextureReference' && dataType.kind !== 'assetReference') return;
	const mimeType = dataType.kind === 'assetReference' ? getAssetReferenceMimeType(dataType) : 'image/*';
	const [selected] = await selectAsset({ multiple: false, mimeType });
	// ダイアログを開いている間に参照先の種類が変わった場合も、旧候補を反映しない。
	if (disposed || selected == null || !areDataTypesEqual(props.dataType, dataType)) return;
	const asset = stateManager.state.assets.value.find(asset => asset.id === selected.id);
	if (asset != null) changeValue(asset.id);
}

function changeValue(value: any) {
	emit('input', value);
}

function changeSignal(signal: [boolean, boolean, boolean]) {
	// カラーピッカーで調整した他のチャンネルとアルファは保持する。
	const channels = signal.map((enabled, index) => enabled === (props.value[index] > 0)
		? props.value[index]
		: Number(enabled));
	changeValue([...channels, props.value[3] ?? 1]);
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

.colorControl {
	display: flex;
	gap: 16px;
}

.assetControl {
	display: flex;
	gap: 8px;
}

.assetButton {
	flex: 1;
	min-width: 0;
	overflow: hidden;
}

.enumError {
	color: var(--THEME-error);
	margin-top: 4px;
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
