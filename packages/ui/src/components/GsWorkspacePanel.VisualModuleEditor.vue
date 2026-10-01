<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button class="_button" style="padding: 4px 6px;" @click="showSwitchMenu"><i class="ti ti-chevron-down"></i> {{ visualModule?.name ?? '' }} [{{ visualModule?.id ?? '' }}]</button>
		<GsButton v-if="visualModule != null" style="margin-left: auto;" small :primary="previewParamsShowing" @click="previewParamsShowing = !previewParamsShowing"><i class="ti ti-adjustments-horizontal"></i> Preview Params</GsButton>
		<GsButton v-if="visualModule != null" style="margin-left: 0;" small :primary="previewPlayback.liveVisualModuleId.value === visualModule.id" @click="previewLive"><i v-if="previewPlayback.liveVisualModuleId.value === visualModule.id" class="ti ti-player-pause"></i><i v-else class="ti ti-player-play"></i> LIVE</GsButton>
	</div>

	<div v-if="visualModule && previewParamsShowing" :key="visualModule.id" :class="$style.previewParams">
		<!-- TODO: struct / array / anyのカスタムパラメータ編集UI。型定義の制約ではなく、現在のUIの対応範囲。 -->
		<template v-for="paramDef of visualModule.paramDefs" :key="paramDef.id">
			<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array' || isParameterType(paramDef, 'any')">{{ paramDef.ui.label }}: Editing is not yet supported.</div>
			<GsVisualParam
				v-else
				:availableVariables="LIVE_VAR_DEFS"
				:paramPath="[paramDef.id]"
				:automationGraphs="[]"
				:paramDef="{ ...paramDef, canNode: false }"
				:paramValue="previewParamValues[paramDef.id]"
				@edit="onPreviewParamEdit"
			/>
		</template>
	</div>

	<GsVisualModuleEditor
		v-if="visualModule"
		:key="visualModule.id"
		:class="$style.editor"
		:visualModule="visualModule"
		:effectStates="effectStates"
		@edit="onEdit"
		@requestAddNode="showAddNodeMenu"
	/>
</div>
</template>

<script lang="ts" setup>
import { areDataTypesEqual } from '@glitch/shared/data-type.ts';
import { isParameterType } from '@glitch/shared/parameter.ts';
import { LIVE_VAR_DEFS } from '@glitch/shared/expression.ts';
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import GsVisualModuleEditor from './GsVisualModuleEditor.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsEffectPicker from './GsEffectPicker.vue';
import GsButton from './common/GsButton.vue';
import GsTabs from './common/GsTabs.vue';
import type { ProjectVisualModule } from '@glitch/shared/project/types.ts';
import type { VisualModuleParamDef, VisualModuleParameterBindings, VisualModuleCustomParameterId } from '@glitch/shared/visual-module/types.ts';
import type { EffectInstanceState } from '@glitch/shared/effect/effect-status.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { VisualModuleEdit } from '@/types/visual-module-editor.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { appStateManager, previewPlayback, visualModuleRendererManagerController } from '@/app.ts';
import * as ui from '@/ui.ts';
import { commitVisualModuleEdit } from '@/utility/visual-module-edit.ts';
import { createInlineAutomationGraph } from '@/utility/automation-graph.ts';
import { createInlineKeyframesTimeline } from '@/utility/keyframes-timeline.ts';

defineProps<{ panel: WorkspacePanel }>();

const previewParamsShowing = ref(false);
const selectedModuleId = ref<ProjectVisualModule['id'] | null>(null);
const visualModule = computed(() => appStateManager.state.visualModules.value.find(module => module.id === selectedModuleId.value)
	?? appStateManager.state.visualModules.value[0] ?? null);

// 選択した定義が削除・置換されても、常に現在のプロジェクトから対象を解決する。
watch(() => visualModule.value?.id, id => {
	selectedModuleId.value = id ?? null;
}, { immediate: true });

const effectStates = computed(() => {
	const module = visualModule.value;
	const states = new Map<string, EffectInstanceState>();
	if (module == null) return states;
	for (const node of module.nodes) {
		if (node.type !== 'effect') continue;
		const state = visualModuleRendererManagerController.getLiveEffectState(module.id, node.id);
		if (state != null) states.set(node.id, state);
	}
	return states;
});

const previewParamValues = ref<VisualModuleParameterBindings>({});
const editedPreviewParamIds = new Set<VisualModuleCustomParameterId>();
let previewModuleId: string | undefined;
let previewParamTypes = new Map<string, VisualModuleParamDef['dataType']>();

watch(visualModule, module => {
	if (module?.id !== previewModuleId) editedPreviewParamIds.clear();
	const values: VisualModuleParameterBindings = {};
	for (const def of module?.paramDefs ?? []) {
		const previousType = previewParamTypes.get(def.id);
		const value = previewParamValues.value[def.id];
		// プレビューで明示的に編集していない値は、定義のデフォルト値に追従する。
		// enumの選択肢が増減しても値と式は維持する。無効な値は描画エラーにし、Undoで復元できるようにする。
		const compatible = previousType != null && (areDataTypesEqual(previousType, def.dataType)
			|| (previousType.kind === 'enum' && def.dataType.kind === 'enum'));
		if (editedPreviewParamIds.has(def.id) && compatible && value != null) {
			values[def.id] = value;
		} else {
			editedPreviewParamIds.delete(def.id);
			values[def.id] = deepClone(def.defaultValue);
		}
	}
	for (const id of editedPreviewParamIds) if (!(id in values)) editedPreviewParamIds.delete(id);
	previewParamValues.value = values;
	previewModuleId = module?.id;
	previewParamTypes = new Map((module?.paramDefs ?? []).map(def => [def.id, def.dataType]));
	if (module != null && previewPlayback.liveVisualModuleId.value === module.id) {
		previewPlayback.updateLiveParamValues(module.id, values);
	}
}, { deep: true, immediate: true });

function onPreviewParamEdit(event: ParamEdit) {
	// TODO: struct / arrayの子の編集・要素操作。型定義では許可しているが、現在の編集UIは未対応。
	if (event.paramPath.length !== 1) return;
	const def = visualModule.value?.paramDefs.find(def => def.id === event.paramPath[0]);
	if (def == null) return;
	const id = def.id;
	const current = previewParamValues.value[id];
	const reset = (): VisualModuleParameterBindings[VisualModuleCustomParameterId] => deepClone(def.defaultValue);
	switch (event.kind) {
		case 'literal': previewParamValues.value[id] = { inputSource: 'literal', value: deepClone(event.value) }; break;
		case 'automationGraphInline': previewParamValues.value[id] = deepClone(event.value); break;
		case 'keyframesTimelineInline': previewParamValues.value[id] = deepClone(event.value); break;
		case 'envVariable': previewParamValues.value[id] = { inputSource: 'envVariable', variable: event.value }; break;
		case 'expression': previewParamValues.value[id] = { inputSource: 'expression', expression: event.value }; break;
		case 'automationGraphReference': previewParamValues.value[id] = { inputSource: 'automationGraphReference', trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start', ...(current?.inputSource === 'automationGraphReference' ? current : {}), automationGraphId: event.value, ...event.options }; break;
		case 'node':
		case 'externalCustomParameterInput': return;
		case 'reset': previewParamValues.value[id] = reset(); break;
		case 'inputSource':
			switch (event.inputSource) {
				case 'literal': previewParamValues.value[id] = reset(); break;
				case 'expression': previewParamValues.value[id] = {
					inputSource: 'expression', expression: AiSON.stringify(current?.inputSource === 'literal' ? current.value : def.defaultValue.value),
				}; break;
				case 'automationGraphReference': previewParamValues.value[id] = { inputSource: 'automationGraphReference', automationGraphId: null, trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start' }; break;
				case 'automationGraphInline': previewParamValues.value[id] = createInlineAutomationGraph(); break;
				case 'keyframesTimelineInline':
					previewParamValues.value[id] = createInlineKeyframesTimeline(def, current);
					break;
				case 'externalCustomParameterInput':
				case 'node':
					return;
			}
			break;
		case 'addElement':
		case 'removeElement':
			return;
	}
	if (event.kind === 'reset' || (event.kind === 'inputSource' && event.inputSource === 'literal')) editedPreviewParamIds.delete(id);
	else editedPreviewParamIds.add(id);
	previewLive();
}

function previewLive() {
	if (visualModule.value == null) return;
	previewPlayback.startLive(visualModule.value.id, previewParamValues.value);
}

function showSwitchMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'New',
		icon: 'ti ti-plus',
		action: () => {

		},
	}, {
		type: 'divider',
	}, ...appStateManager.state.visualModules.value.map(_visualModule => ({
		text: _visualModule.name,
		active: _visualModule.id === visualModule.value?.id,
		action: () => {
			selectedModuleId.value = _visualModule.id;
		},
	}))], ev.currentTarget ?? ev.target);
}

let disposeEffectPicker: (() => void) | undefined;
onBeforeUnmount(() => disposeEffectPicker?.());

function showAddNodeMenu() {
	const module = visualModule.value;
	if (module == null) return;
	// ピッカーを開いた後に選択を変えても、開いた時点のモジュールに追加する。
	const visualModuleId = module.id;
	disposeEffectPicker?.();
	const { dispose } = ui.popup(GsEffectPicker, {}, {
		chosen: effect => {
			if (appStateManager.getVisualModuleById(visualModuleId) == null) return;
			appStateManager.commit('addEffectNode', { visualModuleId, effectId: effect.id, id: genId() });
		},
		closed: () => {
			dispose();
			if (disposeEffectPicker === dispose) disposeEffectPicker = undefined;
		},
	});
	disposeEffectPicker = dispose;
}

function onEdit(event: VisualModuleEdit) {
	const module = visualModule.value;
	if (module == null) return;
	commitVisualModuleEdit(appStateManager, { visualModuleId: module.id }, event);
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding-right: 8px;
}

.previewParams {
	min-height: 0;
	overflow: auto;
}

.editor {
	flex: 1;
	min-height: 0;
}
</style>
