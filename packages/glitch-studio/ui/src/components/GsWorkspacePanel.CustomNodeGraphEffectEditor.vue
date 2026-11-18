<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button class="_button" style="padding: 4px 6px;" @click="showSwitchMenu"><i class="ti ti-chevron-down"></i> {{ customNodeGraphEffect?.name ?? '' }} [{{ prettyId(customNodeGraphEffect?.id ?? '') }}]</button>
		<GsButton v-if="customNodeGraphEffect != null" style="margin-left: auto;" :primary="previewParamsShowing" icon="ti ti-adjustments-horizontal" @click="previewParamsShowing = !previewParamsShowing">{{ i18n.ts._CustomNodeGraphEffect.PreviewParameters }}</GsButton>
		<GsButton v-if="customNodeGraphEffect != null" style="margin-left: 0;" :primary="previewPlayback.livePreviewCustomNodeGraphEffectId.value === customNodeGraphEffect.id" :icon="previewPlayback.livePreviewCustomNodeGraphEffectId.value === customNodeGraphEffect.id ? 'ti ti-player-pause' : 'ti ti-player-play'" @click="previewCustomNodeGraphEffectLivePreview">{{ i18n.ts.Preview }}</GsButton>
	</div>

	<div v-if="customNodeGraphEffect && previewParamsShowing" :key="customNodeGraphEffect.id" :class="$style.previewParams">
		<!-- TODO: struct / array / anyの公開パラメータ編集UI。型定義の制約ではなく、現在のUIの対応範囲。 -->
		<template v-for="paramDef of customNodeGraphEffect.paramDefs" :key="paramDef.id">
			<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array' || isParameterType(paramDef, 'any')">{{ paramDef.ui.label }}{{ i18n.ts._TimelineLayer.EditingUnsupported }}</div>
			<GsVisualParam
				v-else
				:availableVariables="CUSTOM_NODE_GRAPH_EFFECT_LIVE_PREVIEW_VAR_DEFS"
				:paramPath="[paramDef.id]"
				:automationGraphs="[]"
				:projectAutomationGraphs="stateManager.state.automationGraphs.value"
				:paramDef="{ ...paramDef, canNode: false }"
				:paramValue="previewParamValues[paramDef.id]"
				@edit="onPreviewParamEdit"
			/>
		</template>
	</div>

	<GsCustomNodeGraphEffectEditor
		v-if="customNodeGraphEffect"
		:key="customNodeGraphEffect.id"
		:class="$style.editor"
		:customNodeGraphEffect="customNodeGraphEffect"
		:customNodeGraphEffectName="customNodeGraphEffect.name"
		:previewTarget="{ customNodeGraphEffectId: customNodeGraphEffect.id }"
		:assetDropActions="assetDropActions"
		:effectStates="effectStates"
		:exporting="exporting"
		@edit="onEdit"
		@rename="renameCurrentCustomNodeGraphEffect"
		@requestAddEffectNode="showAddEffectNodeMenu"
		@requestExport="exportCurrentCustomNodeGraphEffect"
	/>
</div>
</template>

<script lang="ts" setup>
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { computed, ref, watch, onBeforeUnmount, inject, provide } from 'vue';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { preserveParameterExpressionModifier, validateParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { prettyId } from '@gs/shared/utility/id.ts';
import { CUSTOM_NODE_GRAPH_EFFECT_LIVE_PREVIEW_VAR_DEFS } from '@gs/glitch-studio_shared/custom-node-graph-effect-live-preview-expression.js';
import GsCustomNodeGraphEffectEditor from './GsCustomNodeGraphEffectEditor.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsEffectPicker from './GsEffectPicker.vue';
import GsButton from './common/GsButton.vue';
import GsTabs from './common/GsTabs.vue';
import type { ProjectCustomNodeGraphEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { CustomNodeGraphEffectParamDef, CustomNodeGraphEffectArgumentBindings, CustomNodeGraphEffectPublicParameterId } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { CustomNodeGraphEffectEdit } from '@/types/custom-node-graph-effect-editor.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import { useProjectSession } from '@/project-session.ts';
import * as ui from '@/ui.ts';
import { commitCustomNodeGraphEffectEdit } from '@/utility/custom-node-graph-effect-edit.ts';
import { handleProjectParameterClipboard, handlePreviewParameterClipboard } from '@/utility/parameter-clipboard-actions.ts';
import { createInlineAutomationGraph } from '@/utility/automation-graph.ts';
import { createInlineKeyframesTimeline } from '@/utility/keyframes-timeline.ts';
import { createResetParameterBinding } from '@/utility/parameter-default.ts';
import { exportPortableCustomNodeGraphEffectFile } from '@/utility/portable-custom-node-graph-effect-file.ts';
import { exportCustomNodeGraphEffectFile, importCustomNodeGraphEffectFile } from '@/utility/custom-node-graph-effect-file.ts';
import { createCustomNodeGraphEffectDropActions } from '@/utility/custom-node-graph-effect-drop-actions.ts';
import { preferences } from '@/preferences.ts';
import { previewParameterContextKey } from '@/utility/preview-parameter-editing.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';

const projectSession = useProjectSession();

const { previewPlayback, customNodeGraphEffectRendererManagerController } = projectSession;
const { stateManager } = projectSession.projectContext;

const props = defineProps<{ panel: WorkspacePanel }>();
const workspaceController = inject(workspaceControllerKey)!;
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

const previewParamsShowing = ref(false);
const exporting = ref(false);
const importing = ref(false);
const selectedCustomNodeGraphEffectId = ref<ProjectCustomNodeGraphEffect['id'] | null>(null);
const customNodeGraphEffect = computed(() => stateManager.state.customNodeGraphEffects.value.find(currentCustomNodeGraphEffect => currentCustomNodeGraphEffect.id === selectedCustomNodeGraphEffectId.value)
	?? stateManager.state.customNodeGraphEffects.value[0] ?? null);
const assetDropActions = computed(() => {
	const currentCustomNodeGraphEffect = customNodeGraphEffect.value;
	return currentCustomNodeGraphEffect == null ? null : createCustomNodeGraphEffectDropActions({
		context: projectSession.projectContext,
		projectSessionId: projectSession.id,
		target: { customNodeGraphEffectId: currentCustomNodeGraphEffect.id },
		isActive: () => !disposed && customNodeGraphEffect.value === currentCustomNodeGraphEffect,
		revealAssets: () => workspaceController.revealPanel({ contentType: 'assets', sourcePanelId: props.panel.id }),
	});
});

// 選択した定義が削除・置換されても、常に現在のプロジェクトから対象を解決する。
watch(() => customNodeGraphEffect.value?.id, id => {
	selectedCustomNodeGraphEffectId.value = id ?? null;
}, { immediate: true });

const effectStates = computed(() => {
	const currentCustomNodeGraphEffect = customNodeGraphEffect.value;
	const states = new Map<string, EffectInstanceState>();
	if (currentCustomNodeGraphEffect == null) return states;
	for (const node of currentCustomNodeGraphEffect.nodes) {
		if (node.type !== 'effect') continue;
		const state = customNodeGraphEffectRendererManagerController.getCustomNodeGraphEffectLivePreviewEffectState(currentCustomNodeGraphEffect.id, node.id);
		if (state != null) states.set(node.id, state);
	}
	return states;
});

const previewParamValues = ref<CustomNodeGraphEffectArgumentBindings>({});
const editedPreviewParamIds = new Set<CustomNodeGraphEffectPublicParameterId>();
// Preview Paramsは保存データではないため、取消しだけを既存の一時値へ適用する。
provide(previewParameterContextKey, {
	scope: computed(() => customNodeGraphEffect.value == null ? null : { kind: 'livePreview' as const, customNodeGraphEffectId: customNodeGraphEffect.value.id }),
	label: computed(() => customNodeGraphEffect.value?.name ?? ''),
	beginLivePreviewEdit(path) {
		const customNodeGraphEffectId = customNodeGraphEffect.value?.id ?? null;
		const id = path[0] as CustomNodeGraphEffectPublicParameterId;
		const before = deepClone(previewParamValues.value[id]);
		const wasEdited = editedPreviewParamIds.has(id);
		let active = true;
		return {
			get active() { return active && customNodeGraphEffect.value?.id === customNodeGraphEffectId; },
			update(edit) { if (active && customNodeGraphEffect.value?.id === customNodeGraphEffectId) onPreviewParamEdit({ ...edit, paramPath: path }); },
			finish() { active = false; },
			cancel() {
				if (!active || customNodeGraphEffect.value?.id !== customNodeGraphEffectId) return;
				active = false;
				previewParamValues.value[id] = before;
				if (!wasEdited) editedPreviewParamIds.delete(id);
				if (customNodeGraphEffect.value != null) previewPlayback.updateCustomNodeGraphEffectLivePreviewParamValues(customNodeGraphEffect.value.id, previewParamValues.value);
			},
		};
	},
});
let previewCustomNodeGraphEffectId: string | null = null;
let previewParamTypes = new Map<string, CustomNodeGraphEffectParamDef['dataType']>();

watch(customNodeGraphEffect, currentCustomNodeGraphEffect => {
	if (currentCustomNodeGraphEffect?.id !== previewCustomNodeGraphEffectId) editedPreviewParamIds.clear();
	const values: CustomNodeGraphEffectArgumentBindings = {};
	for (const def of currentCustomNodeGraphEffect?.paramDefs ?? []) {
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
	previewCustomNodeGraphEffectId = currentCustomNodeGraphEffect?.id;
	previewParamTypes = new Map((currentCustomNodeGraphEffect?.paramDefs ?? []).map(def => [def.id, def.dataType]));
	if (currentCustomNodeGraphEffect != null && previewPlayback.livePreviewCustomNodeGraphEffectId.value === currentCustomNodeGraphEffect.id) {
		previewPlayback.updateCustomNodeGraphEffectLivePreviewParamValues(currentCustomNodeGraphEffect.id, values);
	}
}, { deep: true, immediate: true });

function onPreviewParamEdit(event: ParamEdit) {
	if (event.kind === 'copy' || event.kind === 'paste') {
		const currentCustomNodeGraphEffect = customNodeGraphEffect.value;
		if (currentCustomNodeGraphEffect == null) return;
		void handlePreviewParameterClipboard(projectSession.projectContext, projectSession.id, currentCustomNodeGraphEffect.id, event.paramPath, event.kind,
			() => previewParamValues.value, () => !disposed && customNodeGraphEffect.value === currentCustomNodeGraphEffect,
			(id, binding) => {
				previewParamValues.value[id] = binding;
				editedPreviewParamIds.add(id);
				previewPlayback.updateCustomNodeGraphEffectLivePreviewParamValues(currentCustomNodeGraphEffect.id, previewParamValues.value);
			}).catch(error => ui.alert({ type: 'error', text: String(error) }));
		return;
	}
	const rootDefinition = customNodeGraphEffect.value?.paramDefs.find(def => def.id === event.paramPath[0]);
	if (rootDefinition == null) return;
	const id = rootDefinition.id;
	// Viewの数値欄も、プレビュー上の一括操作も、同じ引数ツリーへ反映する。
	// 子の編集で親を作り直す際は、別フィールドの式やキーを維持する。
	const draft = { [id]: deepClone(previewParamValues.value[id] ?? rootDefinition.defaultValue) };
	const parameter = resolveParameter<ValueParameterBinding>({ [id]: rootDefinition }, draft, event.paramPath);
	const { def, value: current } = parameter;
	let next = current;
	const reset = (): CustomNodeGraphEffectArgumentBindings[CustomNodeGraphEffectPublicParameterId] => createResetParameterBinding(def);
	switch (event.kind) {
		case 'literal': next = { inputSource: 'literal', value: deepClone(event.value) }; break;
		case 'automationGraphInline': next = deepClone(event.value); break;
		case 'keyframesTimelineInline': next = deepClone(event.value); break;
		case 'envVariable': next = { inputSource: 'envVariable', variable: event.value }; break;
		case 'expression': next = { inputSource: 'expression', expression: event.value }; break;
		case 'expressionModifier': next = { ...current, expressionModifier: deepClone(event.value) }; break;
		case 'automationGraphReference': next = {
			inputSource: 'automationGraphReference',
			trimmedDurationMs: 1000,
			wrapMode: 'repeat',
			offsetMode: 'start',
			...(current?.inputSource === 'automationGraphReference' ? current : {}),
			automationGraphId: event.value,
			...event.options,
		}; break;
		case 'createPublicParameter':
		case 'createCustomParameter':
		case 'timelineLayerPublicParameterReference':
		case 'node':
		case 'anotherLayerOutput':
		case 'lowerLayerOutput':
		case 'anotherLayerAudio':
		case 'customNodeGraphEffectPublicParameterReference': return;
		case 'customNodeGraphEffectCustomParameterValueReference': return;
		case 'reset': next = reset(); break;
		case 'inputSource':
			switch (event.inputSource) {
				case 'literal': next = reset(); break;
				case 'expression': next = {
					inputSource: 'expression',
					expression: AiSON.stringify(current?.inputSource === 'literal' ? current.value : def.defaultValue.value),
				}; break;
				case 'automationGraphReference': next = {
					inputSource: 'automationGraphReference',
					automationGraphId: null,
					trimmedDurationMs: 1000,
					wrapMode: 'repeat',
					offsetMode: 'start',
				}; break;
				case 'automationGraphInline': next = createInlineAutomationGraph(); break;
				case 'keyframesTimelineInline':
					next = createInlineKeyframesTimeline(def, current);
					break;
				case 'customNodeGraphEffectPublicParameterReference':
				case 'customNodeGraphEffectCustomParameterValueReference':
				case 'anotherLayerOutput':
				case 'lowerLayerOutput':
				case 'lowerLayerAudio':
				case 'anotherLayerAudio':
				case 'node':
					return;
			}
			break;
		case 'addElement':
		case 'removeElement':
			return;
	}
	if (event.kind !== 'reset' && event.kind !== 'expressionModifier') {
		next = preserveParameterExpressionModifier(current, next);
	}
	validateParameterExpressionModifier(def, next);
	parameter.setValue(next);
	previewParamValues.value[id] = draft[id];
	if (event.kind === 'reset' && event.paramPath.length === 1) editedPreviewParamIds.delete(id);
	else editedPreviewParamIds.add(id);
	if (customNodeGraphEffect.value != null) previewPlayback.updateCustomNodeGraphEffectLivePreviewParamValues(customNodeGraphEffect.value.id, previewParamValues.value);
}

function previewCustomNodeGraphEffectLivePreview() {
	if (customNodeGraphEffect.value == null) return;
	previewPlayback.startCustomNodeGraphEffectLivePreview(customNodeGraphEffect.value.id, previewParamValues.value);
}

function showSwitchMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: `${i18n.ts._CustomNodeGraphEffect.Import}...`,
		icon: 'ti ti-upload',
		action: importCustomNodeGraphEffect,
	}, {
		text: i18n.ts.New,
		icon: 'ti ti-plus',
		action: addCustomNodeGraphEffect,
	}, {
		type: 'divider',
	}, ...stateManager.state.customNodeGraphEffects.value.map(_customNodeGraphEffect => ({
		text: _customNodeGraphEffect.name,
		active: _customNodeGraphEffect.id === customNodeGraphEffect.value?.id,
		action: () => {
			selectedCustomNodeGraphEffectId.value = _customNodeGraphEffect.id;
		},
	}))], ev.currentTarget ?? ev.target);
}

function addCustomNodeGraphEffect() {
	const target = stateManager.commit('createCustomNodeGraphEffect', {});
	selectedCustomNodeGraphEffectId.value = target.customNodeGraphEffectId;
}

async function importCustomNodeGraphEffect() {
	if (importing.value) return;
	importing.value = true;
	try {
		const id = await importCustomNodeGraphEffectFile(projectSession.projectContext);
		if (id != null) selectedCustomNodeGraphEffectId.value = id;
	} finally {
		importing.value = false;
	}
}

function renameCurrentCustomNodeGraphEffect(name: string) {
	const currentCustomNodeGraphEffect = customNodeGraphEffect.value;
	if (currentCustomNodeGraphEffect == null || currentCustomNodeGraphEffect.name === name) return;
	stateManager.commit('setCustomNodeGraphEffectName', { target: { customNodeGraphEffectId: currentCustomNodeGraphEffect.id }, name });
}

async function exportCurrentCustomNodeGraphEffect(format: 'gscnge' | 'web' = 'gscnge') {
	const currentCustomNodeGraphEffect = customNodeGraphEffect.value;
	if (currentCustomNodeGraphEffect == null || exporting.value) return;
	exporting.value = true;
	try {
		if (format === 'web') await exportPortableCustomNodeGraphEffectFile(projectSession, currentCustomNodeGraphEffect, currentCustomNodeGraphEffect.name);
		else await exportCustomNodeGraphEffectFile(projectSession.projectContext, currentCustomNodeGraphEffect, currentCustomNodeGraphEffect.name);
	} finally {
		exporting.value = false;
	}
}

let disposeEffectPicker: (() => void) | null = null;
onBeforeUnmount(() => disposeEffectPicker?.());

function showAddEffectNodeMenu() {
	disposeEffectPicker?.();
	const { dispose } = ui.popup(GsEffectPicker, {}, {
		chosen: effect => {
			if (projectSession.projectContext.getCustomNodeGraphEffectById(customNodeGraphEffect.value.id) == null) return;
			stateManager.commit('createCustomNodeGraphEffectEffectNode', { customNodeGraphEffect: { customNodeGraphEffectId: customNodeGraphEffect.value.id }, effectId: effect.id,
				connectionMode: preferences.s.customNodeGraphEffectAutoConnectOnNodeAdd ? 'appendToPrimaryOutput' : 'none', connectionTypePolicy: preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch' });
		},
		closed: () => {
			dispose();
			if (disposeEffectPicker === dispose) disposeEffectPicker = null;
		},
	}, projectSession);
	disposeEffectPicker = dispose;
}

function onEdit(event: CustomNodeGraphEffectEdit) {
	const currentCustomNodeGraphEffect = customNodeGraphEffect.value;
	if (currentCustomNodeGraphEffect == null) return;
	if (event.kind === 'customParameterClipboard') {
		void handleProjectParameterClipboard(projectSession.projectContext, projectSession.id,
			{ kind: 'customParameter', customNodeGraphEffectTarget: { customNodeGraphEffectId: currentCustomNodeGraphEffect.id }, paramPath: [event.parameterId] },
			event.operation, () => !disposed && customNodeGraphEffect.value === currentCustomNodeGraphEffect).catch(error => ui.alert({ type: 'error', text: String(error) }));
		return;
	}
	if (event.kind === 'editNodeParam' && (event.edit.kind === 'copy' || event.edit.kind === 'paste')) {
		void handleProjectParameterClipboard(projectSession.projectContext, projectSession.id,
			{ kind: 'node', customNodeGraphEffectTarget: { customNodeGraphEffectId: currentCustomNodeGraphEffect.id }, nodeId: event.nodeId, paramPath: event.edit.paramPath },
			event.edit.kind, () => !disposed && customNodeGraphEffect.value === currentCustomNodeGraphEffect).catch(error => ui.alert({ type: 'error', text: String(error) }));
		return;
	}
	commitCustomNodeGraphEffectEdit(stateManager, { customNodeGraphEffectId: currentCustomNodeGraphEffect.id }, event);
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
