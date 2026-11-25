<template>
<div :class="$style.root" data-test-project-curve-animations>
	<div :class="$style.toolbar">
		<GsButton v-tooltip="i18n.ts._CurveAnimation.AddCurveAnimation" data-test-add-curve-animation icon="ti ti-plus" iconOnly @click="addCurveAnimation()"></GsButton>
		<GsButton data-test-select-curve-animation @click="selectCurveAnimation"><i class="ti ti-chevron-down"></i> {{ selectedCurveAnimation != null ? selectedCurveAnimation.nameForReference : '' }}</GsButton>
	</div>
	<template v-if="selectedCurveAnimation != null">
		<div :class="$style.header">
			<GsTabs v-model="tab" :def="tabs" data-test-nodes-effect-tabs/>
		</div>

		<div v-if="tab === 'curveAnimation'" :class="$style.editor">
			<GsCurveAnimationPointsEditor :key="selectedCurveAnimation.id + String(selectedCurveAnimation.isNormalized)" :points="selectedCurveAnimation.points" :isNormalized="selectedCurveAnimation.isNormalized" @change="updatePoints"/>
		</div>
		<div v-else-if="tab === 'settings'" class="_spacer _gaps_l">
			<GsInput :key="selectedCurveAnimation.id" data-test-curve-animation-reference-name monospace :manualSave="true" :modelValue="selectedCurveAnimation.nameForReference" @update:modelValue="setNameForReference">
				<template #label>{{ i18n.ts._ParameterEditor.ReferenceName }}</template>
			</GsInput>

			<GsSelect :modelValue="selectedCurveAnimation.isNormalized ? 'normalized' : 'milliseconds'" :items="timeAxisItems" @update:modelValue="setNormalized($event === 'normalized')">
				<template #label>{{ i18n.ts._Parameter.TimeAxis }}</template>
			</GsSelect>

			<GsButton icon="ti ti-copy" @click="addCurveAnimation(selectedCurveAnimation)">{{ i18n.ts.Duplicate }}</GsButton>

			<GsButton data-test-delete-curve-animation danger icon="ti ti-trash" @click="removeCurveAnimation">{{ i18n.ts.Delete }}</GsButton>
		</div>
	</template>
	<div v-else>
		<div>{{ i18n.ts._CurveAnimation.Empty }}</div>
		<GsButton data-test-add-curve-animation icon="ti ti-plus" @click="addCurveAnimation()">{{ i18n.ts._CurveAnimation.AddCurveAnimation }}</GsButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsCurveAnimationPointsEditor from './GsCurveAnimationPointsEditor.vue';
import GsTabs from './common/GsTabs.vue';
import type { CurveAnimation, BezierAnchorPoint } from '@gs/shared/curve-animation/curve-animation.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import { setInlineCurveAnimationNormalized } from '@/utility/curve-animation.ts';

defineProps<{ panel: WorkspacePanel }>();

const projectSession = useProjectSession();

const tab = ref('curveAnimation');
const tabs = [
	{ id: 'curveAnimation', label: i18n.ts._CurveAnimation.CurveAnimation },
	{ id: 'settings', label: i18n.ts.Settings },
];

const { stateManager } = projectSession.projectContext;
const curveAnimations = stateManager.state.curveAnimations;
const selectedCurveAnimationId = ref<string | null>(null);
const selectedCurveAnimation = computed(() => curveAnimations.value.find(curveAnimation => curveAnimation.id === selectedCurveAnimationId.value) ?? curveAnimations.value[0] ?? null);
const timeAxisItems = [
	{ label: i18n.ts._Parameter.NormalizedTime, value: 'normalized' },
	{ label: i18n.ts._Parameter.Milliseconds, value: 'milliseconds' },
];

function selectCurveAnimation(ev: PointerEvent) {
	ui.popupMenu(curveAnimations.value.map(curveAnimation => ({
		text: curveAnimation.nameForReference,
		active: selectedCurveAnimation.value?.id === curveAnimation.id,
		action: () => { selectedCurveAnimationId.value = curveAnimation.id; },
	})), ev.currentTarget ?? ev.target);
}

function setNameForReference(nameForReference: string) {
	const curveAnimation = selectedCurveAnimation.value;
	if (curveAnimation == null || curveAnimation.nameForReference === nameForReference) return;
	try {
		stateManager.commit('replaceProjectCurveAnimation', { curveAnimationId: curveAnimation.id, definition: { ...curveAnimation, nameForReference } });
	} catch (error) {
		ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	}
}

function addCurveAnimation(source?: CurveAnimation) {
	const result = source == null ? stateManager.commit('createProjectCurveAnimation', {})
		: stateManager.commit('duplicateProjectCurveAnimation', { curveAnimationId: source.id });
	selectedCurveAnimationId.value = result.curveAnimationId;
}

function removeCurveAnimation() {
	if (selectedCurveAnimation.value != null) stateManager.commit('removeProjectCurveAnimation', { curveAnimationId: selectedCurveAnimation.value.id });
}

function updatePoints(points: BezierAnchorPoint[], mergeKey: string | null) {
	if (selectedCurveAnimation.value != null) stateManager.commit('replaceProjectCurveAnimation', { curveAnimationId: selectedCurveAnimation.value.id, definition: { ...selectedCurveAnimation.value, points } }, mergeKey);
}

function setNormalized(isNormalized: boolean) {
	const curveAnimation = selectedCurveAnimation.value;
	if (curveAnimation == null || curveAnimation.isNormalized === isNormalized) return;
	const converted = setInlineCurveAnimationNormalized({ inputSource: 'curveAnimationInline', curveAnimation: curveAnimation, trimmedDurationMs: 1000, wrapMode: 'clamp', offsetMode: 'start' }, isNormalized);
	stateManager.commit('replaceProjectCurveAnimation', { curveAnimationId: curveAnimation.id, definition: { ...curveAnimation, ...converted.curveAnimation } });
}
</script>

<style module lang="scss">
.root {
	height: 100%;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	overflow: auto;
}
.toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 4px 8px 0 8px;
}
.editor {
	flex: 1;
}
</style>
