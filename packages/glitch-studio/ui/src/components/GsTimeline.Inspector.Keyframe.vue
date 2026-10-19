<template>
<GsFolder v-if="selectedKeyframe != null" defaultOpen asSection :withSpacer="false">
	<template #icon><i class="ti ti-keyframe"></i></template>
	<template #label>{{ i18n.ts._TimelineKeyframe.Title }} {{ selectedKeyframe.def.ui.label }}</template>
	<div style="margin-left: 16px; border-left: solid 1px #fff2;">
		<div class="_spacer _gaps_m">
			<GsInput data-test-keyframe-time type="number" :min="selectedKeyframe.minX" :max="selectedKeyframe.maxX" :modelValue="selectedKeyframe.keyframe.x" @update:modelValue="updateKeyframeTime">
				<template #label>{{ i18n.ts.Time }}</template>
				<template #suffix>ms</template>
			</GsInput>
			<div>{{ i18n.ts.Value }}</div>
			<GsLiteralLeafValueControl
				:dataType="selectedKeyframe.def.dataType"
				:control="selectedKeyframe.def.ui.control"
				:value="selectedKeyframe.keyframe.value"
				:title="selectedKeyframe.def.ui.label"
				@input="value => updateKeyframeValue(value)"
				@beginChanging="keyframeValueMergeKey = genId()"
				@changeContinuous="value => updateKeyframeValue(value, keyframeValueMergeKey)"
				@changeFinished="keyframeValueMergeKey = null"
				@reset="updateKeyframeValue(selectedKeyframe.def.defaultValue.value)"
			/>
			<template v-for="editor in keyframeInterpolationEditors" :key="editor.keyframe.id">
				<GsSelect :data-test-keyframe-interpolation="editor.keyframe.id" :modelValue="editor.keyframe.interpolation.type" :items="keyframeInterpolationItems" @update:modelValue="type => updateKeyframeInterpolationType(editor.keyframe.id, type)">
					<template #label>{{ editor.label }}</template>
				</GsSelect>
				<GsSelect v-if="editor.direction != null" :modelValue="editor.direction" :items="easingDirectionItems" @update:modelValue="direction => updateKeyframeEasingDirection(editor.keyframe.id, direction)">
					<template #label>{{ i18n.ts._TimelineKeyframe.EasingDirection }}</template>
				</GsSelect>
			</template>
			<GsButton data-test-remove-keyframe danger icon="ti ti-trash" @click="emit('remove')">{{ i18n.ts._TimelineKeyframe.Remove }}</GsButton>
		</div>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { computed, ref, watch } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { supportsKeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { KeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { EasingDirection } from '@gs/shared/easing.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineKeyframeSelection } from '@/utility/timeline-selection.ts';
import type { GsSelectItem } from './common/GsSelect.vue';
import { getTimelineKeyframeEditTarget } from '@/utility/timeline-keyframe-edit.ts';
import { updateInlineKeyframe } from '@/utility/keyframes-timeline.ts';
import { appContext } from '@/app.ts';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';

const props = defineProps<{ sceneId: string; layer: TimelineLayer; selection: TimelineKeyframeSelection }>();
const emit = defineEmits<{ remove: [] }>();
const { stateManager } = appContext.projectContext;
const selectedKeyframe = computed(() => getTimelineKeyframeEditTarget(stateManager.state, props.layer, props.selection));
const keyframeValueMergeKey = ref<string | null>(null);
watch(() => props.selection, () => { keyframeValueMergeKey.value = null; });

const keyframeInterpolationItems: GsSelectItem<KeyframeInterpolation['type']>[] = [
	{ label: i18n.ts._TimelineKeyframe.Hold, value: 'hold' },
	{ label: i18n.ts._FilterModes.linear, value: 'linear' },
	{ label: 'Sine', value: 'ease:sine' },
	{ label: 'Quad', value: 'ease:quad' },
	{ label: 'Cubic', value: 'ease:cubic' },
	{ label: 'Quart', value: 'ease:quart' },
	{ label: 'Quint', value: 'ease:quint' },
	{ label: 'Expo', value: 'ease:expo' },
	{ label: 'Circ', value: 'ease:circ' },
	{ label: 'Back', value: 'ease:back' },
	{ label: 'Elastic', value: 'ease:elastic' },
	{ label: 'Bounce', value: 'ease:bounce' },
];
const easingDirectionItems: GsSelectItem<EasingDirection>[] = [
	{ label: 'In', value: 'in' },
	{ label: 'Out', value: 'out' },
	{ label: 'InOut', value: 'inOut' },
];
const keyframeInterpolationEditors = computed(() => {
	const selected = selectedKeyframe.value;
	if (selected == null || !supportsKeyframeInterpolation(selected.def.dataType)) return [];
	const editors = [{ keyframe: selected.keyframe, label: i18n.ts._TimelineKeyframe.InterpolationToNext }];
	// このキーまでの補間は直前のキーが所有する。選択は維持し、編集先のIDだけを切り替える。
	if (selected.previousKeyframe != null) {
		editors.unshift({ keyframe: selected.previousKeyframe, label: i18n.ts._TimelineKeyframe.InterpolationFromPrevious });
	}
	return editors.map(editor => ({
		...editor,
		direction: 'direction' in editor.keyframe.interpolation ? editor.keyframe.interpolation.direction : null,
	}));
});

function updateKeyframe(keyframeId: string, patch: { x?: number; value?: unknown; interpolation?: KeyframeInterpolation }, mergeKey?: string | null) {
	const selected = selectedKeyframe.value;
	if (selected == null || selected.selection.target === 'utterance') return;
	const value = updateInlineKeyframe(selected.binding, selected.def, keyframeId, patch);
	if (value == null) return;
	stateManager.commit('editTimelineLayerParam', {
		sceneId: props.sceneId,
		layerId: selected.selection.layerId, target: selected.selection.target,
		paramPath: selected.selection.paramPath,
		edit: { kind: 'keyframesTimelineInline', value },
	}, mergeKey);
}

function updateKeyframeInterpolationType(keyframeId: string, type: KeyframeInterpolation['type']) {
	const current = selectedKeyframe.value?.binding.keyframesTimeline.keyframes.find(keyframe => keyframe.id === keyframeId)?.interpolation;
	if (current == null) return;
	const interpolation: KeyframeInterpolation = type === 'linear' || type === 'hold' ? { type }
		: { type, direction: 'direction' in current ? current.direction : 'inOut' };
	updateKeyframe(keyframeId, { interpolation });
}

function updateKeyframeEasingDirection(keyframeId: string, direction: EasingDirection) {
	const interpolation = selectedKeyframe.value?.binding.keyframesTimeline.keyframes.find(keyframe => keyframe.id === keyframeId)?.interpolation;
	if (interpolation == null || !('direction' in interpolation)) return;
	updateKeyframe(keyframeId, { interpolation: { ...interpolation, direction } });
}

function updateKeyframeValue(value: unknown, mergeKey?: string | null) {
	const selected = selectedKeyframe.value;
	if (selected == null) return;
	updateKeyframe(selected.selection.keyframeId, { value }, mergeKey);
}

function updateKeyframeTime(value: string | number) {
	const selected = selectedKeyframe.value;
	const x = Number(value);
	if (selected == null || !Number.isFinite(x)) return;
	updateKeyframe(selected.selection.keyframeId, { x: Math.max(selected.minX, Math.min(selected.maxX, x)) });
}
</script>
