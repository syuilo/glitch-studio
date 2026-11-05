<template>
<div v-if="editableDefinition != null" class="_gaps_m" data-test-inline-keyframes-editor>
	<div v-for="keyframe in sortedKeyframes" :key="keyframe.id" class="_gaps_s" :data-test-inline-keyframe="keyframe.id">
		<GsInput type="number" :min="0" :step="binding.keyframesTimeline.isNormalized ? 0.01 : 1" :modelValue="keyframe.x" :data-test-inline-keyframe-time="keyframe.id" @update:modelValue="value => updateTime(keyframe.id, Number(value))">
			<template #label>{{ i18n.ts.Time }}</template>
			<template v-if="!binding.keyframesTimeline.isNormalized" #suffix>ms</template>
		</GsInput>
		<GsLiteralLeafValueControl
			:dataType="editableDefinition.dataType" :control="editableDefinition.ui.control" :value="keyframe.value"
			:data-test-inline-keyframe-value="keyframe.id"
			@input="value => update(keyframe.id, { value })"
			@beginChanging="valueMergeKey = genId()"
			@changeContinuous="value => update(keyframe.id, { value }, valueMergeKey)"
			@changeFinished="valueMergeKey = null"
			@reset="update(keyframe.id, { value: definition.defaultValue.value })"
		/>
		<GsSelect v-if="supportsKeyframeInterpolation(definition.dataType)" :modelValue="keyframe.interpolation.type" :items="interpolationItems" :data-test-inline-keyframe-interpolation="keyframe.id" @update:modelValue="type => updateInterpolation(keyframe.id, type)">
			<template #label>{{ i18n.ts._TimelineKeyframe.InterpolationToNext }}</template>
		</GsSelect>
		<GsSelect v-if="'direction' in keyframe.interpolation" :modelValue="keyframe.interpolation.direction" :items="directionItems" @update:modelValue="direction => updateDirection(keyframe.id, direction)">
			<template #label>{{ i18n.ts._TimelineKeyframe.EasingDirection }}</template>
		</GsSelect>
		<GsButton danger icon="ti ti-trash" :data-test-remove-inline-keyframe="keyframe.id" @click="remove(keyframe.id)">{{ i18n.ts._TimelineKeyframe.Remove }}</GsButton>
	</div>
	<GsButton data-test-add-inline-keyframe icon="ti ti-plus" @click="add">{{ i18n.ts._Parameter.AddKeyframe }}</GsButton>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { supportsKeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import { canEditKeyframesTimeline, updateInlineKeyframe, appendInlineKeyframes, createInlineKeyframesTimeline } from '@/utility/keyframes-timeline.ts';
import type { KeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { EasingDirection } from '@gs/shared/easing.ts';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsButton from './common/GsButton.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';
import { i18n } from '@/i18n.ts';

type InlineKeyframesBinding = Extract<ValueParameterBinding, { inputSource: 'keyframesTimelineInline' }>;
const props = defineProps<{ definition: ParameterDefinition; binding: InlineKeyframesBinding }>();
const emit = defineEmits<{ update: [binding: InlineKeyframesBinding, mergeKey?: string | null] }>();
const valueMergeKey = ref<string | null>(null);
const editableDefinition = computed(() => canEditKeyframesTimeline(props.definition, props.binding) ? props.definition : null);
const sortedKeyframes = computed(() => props.binding.keyframesTimeline.keyframes.toSorted((a, b) => a.x - b.x));
const interpolationItems = [
	{ label: i18n.ts._TimelineKeyframe.Hold, value: 'hold' }, { label: i18n.ts._FilterModes.linear, value: 'linear' },
	...(['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce'] as const).map(name => ({ label: name, value: `ease:${name}` as const })),
];
const directionItems: { label: string; value: EasingDirection }[] = [{ label: 'In', value: 'in' }, { label: 'Out', value: 'out' }, { label: 'InOut', value: 'inOut' }];

function update(id: string, patch: { x?: number; value?: unknown; interpolation?: KeyframeInterpolation }, mergeKey?: string | null) {
	const binding = updateInlineKeyframe(props.binding, props.definition, id, patch);
	if (binding != null) emit('update', binding, mergeKey);
}

function updateTime(id: string, x: number) {
	if (props.binding.keyframesTimeline.keyframes.some(keyframe => keyframe.id !== id && keyframe.x === x)) return;
	update(id, { x });
}

function updateInterpolation(id: string, type: KeyframeInterpolation['type']) {
	const previous = props.binding.keyframesTimeline.keyframes.find(keyframe => keyframe.id === id)?.interpolation;
	if (previous == null) return;
	update(id, { interpolation: type === 'hold' || type === 'linear' ? { type } : { type, direction: 'direction' in previous ? previous.direction : 'inOut' } });
}

function updateDirection(id: string, direction: EasingDirection) {
	const previous = props.binding.keyframesTimeline.keyframes.find(keyframe => keyframe.id === id)?.interpolation;
	if (previous != null && 'direction' in previous) update(id, { interpolation: { ...previous, direction } });
}

function add() {
	const last = sortedKeyframes.value.at(-1);
	// ここで扱うxは保存されたキー自身の座標。再生時刻のmsへ読み替えず、
	// 最後の値を複製することで正規化されたキーでも末尾の値と加工式を維持する。
	const keyframe = last == null ? createInlineKeyframesTimeline(props.definition).keyframesTimeline.keyframes[0] : deepClone(last);
	if (last != null) {
		keyframe.id = genId();
		keyframe.x = last.x + (props.binding.keyframesTimeline.isNormalized ? 0.1 : 1000);
	}
	const binding = appendInlineKeyframes(props.binding, props.definition, [keyframe]);
	if (binding != null) emit('update', binding);
}

function remove(id: string) {
	const binding = deepClone(props.binding);
	const index = binding.keyframesTimeline.keyframes.findIndex(keyframe => keyframe.id === id);
	if (index < 0) return;
	binding.keyframesTimeline.keyframes.splice(index, 1);
	emit('update', binding);
}
</script>
