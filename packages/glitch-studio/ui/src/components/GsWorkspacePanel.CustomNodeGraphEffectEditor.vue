<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button class="_button" style="padding: 4px 6px;" @click="showSwitchMenu"><i class="ti ti-chevron-down"></i> {{ customNodeGraphEffect?.name ?? '' }} [{{ prettyId(customNodeGraphEffect?.id ?? '') }}]</button>
		<GsButton v-if="customNodeGraphEffect != null" style="margin-left: auto;" :primary="previewPlayback.livePreviewCustomNodeGraphEffectId.value === customNodeGraphEffect.id" @click="previewCustomNodeGraphEffectLivePreview">{{ i18n.ts.Preview }}</GsButton>
		<span v-if="previewPlayback.livePreviewCustomNodeGraphEffectId.value === customNodeGraphEffect?.id && projectSession.effectLivePreviewManagerController.preparationStatus.value?.type === 'loading'">{{ i18n.ts.Loading }}</span>
	</div>

	<GsCustomNodeGraphEffectEditor
		v-if="customNodeGraphEffect"
		:key="customNodeGraphEffect.id"
		:class="$style.editor"
		:customNodeGraphEffect="customNodeGraphEffect"
		:customNodeGraphEffectName="customNodeGraphEffect.name"
		:previewTarget="{ customNodeGraphEffectId: customNodeGraphEffect.id }"
		:assetDropActions="assetDropActions"
		:exporting="exporting"
		@edit="onEdit"
		@rename="renameCurrentCustomNodeGraphEffect"
		@requestAddEffectNode="showAddEffectNodeMenu"
		@requestExport="exportCurrentCustomNodeGraphEffect"
	>
		<template #preview>
			<div :class="$style.previewParams">
				<GsEffectLivePreviewInput
					:effectSource="{ type: 'customNodeGraphEffectReference', id: customNodeGraphEffect.id }"
					@activate="previewCustomNodeGraphEffectLivePreview"
				/>
				<!-- 構造化された公開パラメータのプレビュー編集は未対応。 -->
				<template v-for="paramDef of customNodeGraphEffect.paramDefs" :key="paramDef.id">
					<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array'">{{ paramDef.ui.label }}{{ i18n.ts._TimelineLayer.EditingUnsupported }}</div>
					<GsVisualParam
						v-else
						previewMediaInputEnabled
						:availableVariables="EFFECT_LIVE_PREVIEW_VAR_DEFS"
						:paramPath="[paramDef.id]"
						:automationGraphs="[]"
						:projectAutomationGraphs="stateManager.state.automationGraphs.value"
						:paramDef="paramDef"
						:paramValue="previewParamValues[paramDef.id]"
						@edit="onPreviewParamEdit"
					/>
				</template>
			</div>
		</template>
	</GsCustomNodeGraphEffectEditor>
</div>
</template>

<script lang="ts" setup>
import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { computed, ref, watch, onBeforeUnmount, inject, provide } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { prettyId } from '@gs/shared/utility/id.ts';
import { EFFECT_LIVE_PREVIEW_VAR_DEFS } from '@gs/glitch-studio_shared/effect-live-preview-expression.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import GsCustomNodeGraphEffectEditor from './GsCustomNodeGraphEffectEditor.vue';
import GsEffectLivePreviewInput from './GsEffectLivePreviewInput.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsEffectPicker from './GsEffectPicker.vue';
import GsButton from './common/GsButton.vue';
import type { ProjectCustomNodeGraphEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { CustomNodeGraphEffectParamDef } from '@/types/custom-node-graph-effect-view.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { CustomNodeGraphEffectEdit } from '@/types/custom-node-graph-effect-editor.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { canUseEffectLivePreviewInput, isEffectLivePreviewMediaBinding, type EffectLivePreviewParameterBinding } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';
import { getCustomNodeGraphEffectView } from '@/utility/custom-node-graph-effect-view.ts';
import { i18n } from '@/i18n.ts';
import { useProjectSession } from '@/project-session.ts';
import * as ui from '@/ui.ts';
import { commitCustomNodeGraphEffectEdit } from '@/utility/custom-node-graph-effect-edit.ts';
import { handleProjectParameterClipboard, handlePreviewParameterClipboard } from '@/utility/parameter-clipboard-actions.ts';
import { exportPortableCustomNodeGraphEffectFile } from '@/utility/portable-custom-node-graph-effect-file.ts';
import { exportCustomNodeGraphEffectFile, importCustomNodeGraphEffectFile } from '@/utility/custom-node-graph-effect-file.ts';
import { createCustomNodeGraphEffectDropActions } from '@/utility/custom-node-graph-effect-drop-actions.ts';
import { preferences } from '@/preferences.ts';
import { editEffectLivePreviewParameter } from '@/utility/effect-live-preview-parameter.ts';
import { previewParameterContextKey } from '@/utility/preview-parameter-editing.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';

const projectSession = useProjectSession();

const { previewPlayback } = projectSession;
const { stateManager } = projectSession.projectContext;

const props = defineProps<{ panel: WorkspacePanel }>();
const workspaceController = inject(workspaceControllerKey)!;
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

const exporting = ref(false);
const importing = ref(false);
const selectedCustomNodeGraphEffectId = ref<ProjectCustomNodeGraphEffect['id'] | null>(null);
const registration = computed(() => stateManager.state.customNodeGraphEffects.value.find(currentCustomNodeGraphEffect => currentCustomNodeGraphEffect.id === selectedCustomNodeGraphEffectId.value)
	?? stateManager.state.customNodeGraphEffects.value[0] ?? null);
const customNodeGraphEffect = computed(() => {
	const entry = registration.value;
	return entry == null ? null : { ...entry, ...getCustomNodeGraphEffectView(entry, stateManager.state) };
});
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

const previewParamValues = ref<Record<string, EffectLivePreviewParameterBinding>>({});
const editedPreviewParamIds = new Set<string>();

function synchronizePreviewParameters(id: string, activate: boolean) {
	const overrides = Object.fromEntries([...editedPreviewParamIds].map(key => [key, previewParamValues.value[key]]));
	projectSession.storeCustomNodeGraphEffectPreviewParamValues(id, overrides);
	if (activate || previewPlayback.livePreviewCustomNodeGraphEffectId.value === id) {
		previewPlayback.updateEffectLivePreviewParamValues({ type: 'customNodeGraphEffectReference', id }, overrides);
	}
}
// Preview Paramsは保存データではないため、取消しだけを既存の一時値へ適用する。
provide(previewParameterContextKey, {
	scope: computed(() => customNodeGraphEffect.value == null ? null : {
		kind: 'livePreview', effectSource: { type: 'customNodeGraphEffectReference', id: customNodeGraphEffect.value.id },
	} as const),
	label: computed(() => customNodeGraphEffect.value?.name ?? ''),
	beginLivePreviewEdit(path) {
		const customNodeGraphEffectId = customNodeGraphEffect.value?.id ?? null;
		const id = path[0] as string;
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
				if (customNodeGraphEffect.value != null) synchronizePreviewParameters(customNodeGraphEffect.value.id, true);
			},
		};
	},
});
let previewCustomNodeGraphEffectId: string | null = null;
let previewParamTypes = new Map<string, CustomNodeGraphEffectParamDef['dataType']>();

watch(customNodeGraphEffect, currentCustomNodeGraphEffect => {
	const id = currentCustomNodeGraphEffect?.id ?? null;
	const switched = id !== previewCustomNodeGraphEffectId;
	if (switched) {
		editedPreviewParamIds.clear();
		previewParamValues.value = id == null ? {} : { ...projectSession.getCustomNodeGraphEffectPreviewParamValues(id) };
		for (const key of Object.keys(previewParamValues.value)) editedPreviewParamIds.add(key);
	}
	const values: Record<string, EffectLivePreviewParameterBinding> = {};
	for (const def of currentCustomNodeGraphEffect?.paramDefs ?? []) {
		const previousType = previewParamTypes.get(def.id);
		const value = previewParamValues.value[def.id];
		// プレビューで明示的に編集していない値は、定義のデフォルト値に追従する。
		// enumの選択肢が増減しても値と式は維持する。無効な値は描画エラーにし、Undoで復元できるようにする。
		const compatible = (switched || (previousType != null && (areDataTypesEqual(previousType, def.dataType)
			|| (previousType.kind === 'enum' && def.dataType.kind === 'enum'))))
			&& (value == null || !isEffectLivePreviewMediaBinding(value) || canUseEffectLivePreviewInput(def, value.inputSource));
		if (editedPreviewParamIds.has(def.id) && compatible && value != null) {
			values[def.id] = value;
		} else {
			editedPreviewParamIds.delete(def.id);
			values[def.id] = createDefaultParameterBinding(def);
		}
	}
	for (const id of editedPreviewParamIds) if (!(id in values)) editedPreviewParamIds.delete(id);
	previewParamValues.value = values;
	previewCustomNodeGraphEffectId = currentCustomNodeGraphEffect?.id ?? null;
	previewParamTypes = new Map((currentCustomNodeGraphEffect?.paramDefs ?? []).map(def => [def.id, def.dataType]));
	if (id != null) synchronizePreviewParameters(id, false);
}, { deep: true, immediate: true });

function onPreviewParamEdit(event: ParamEdit) {
	if (event.kind === 'copy' || event.kind === 'paste') {
		const currentCustomNodeGraphEffect = customNodeGraphEffect.value;
		if (currentCustomNodeGraphEffect == null) return;
		void handlePreviewParameterClipboard(projectSession.projectContext, projectSession.id, { type: 'customNodeGraphEffectReference', id: currentCustomNodeGraphEffect.id }, event.paramPath, event.kind,
			id => ({ binding: previewParamValues.value[id] ?? null, followsDefault: !editedPreviewParamIds.has(id) }),
			() => !disposed && customNodeGraphEffect.value === currentCustomNodeGraphEffect,
			(id, binding) => {
				previewParamValues.value[id] = binding;
				editedPreviewParamIds.add(id);
				synchronizePreviewParameters(currentCustomNodeGraphEffect.id, true);
			}).catch(error => ui.alert({ type: 'error', text: String(error) }));
		return;
	}
	const rootDefinition = customNodeGraphEffect.value?.paramDefs.find(def => def.id === event.paramPath[0]);
	if (rootDefinition == null) return;
	const id = rootDefinition.id;
	// Viewの数値欄も、プレビュー上の一括操作も、同じ引数ツリーへ反映する。
	// 子の編集で親を作り直す際は、別フィールドの式やキーを維持する。
	const draft = { [id]: previewParamValues.value[id] == null ? createDefaultParameterBinding(rootDefinition) : deepClone(previewParamValues.value[id]) };
	const parameter = resolveParameter<EffectLivePreviewParameterBinding>({ [id]: rootDefinition }, draft, event.paramPath);
	const { def, value: current } = parameter;
	const next = editEffectLivePreviewParameter(def, current, event);
	if (next == null) return;
	parameter.setValue(next);
	previewParamValues.value[id] = draft[id];
	if (event.kind === 'reset' && event.paramPath.length === 1) editedPreviewParamIds.delete(id);
	else editedPreviewParamIds.add(id);
	if (customNodeGraphEffect.value != null) synchronizePreviewParameters(customNodeGraphEffect.value.id, true);
}

function previewCustomNodeGraphEffectLivePreview() {
	if (customNodeGraphEffect.value == null) return;
	projectSession.startCustomNodeGraphEffectLivePreview(customNodeGraphEffect.value.id);
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
		if (format === 'web') await exportPortableCustomNodeGraphEffectFile(projectSession, currentCustomNodeGraphEffect.definition, currentCustomNodeGraphEffect.name, currentCustomNodeGraphEffect.nodeMetadata);
		else await exportCustomNodeGraphEffectFile(projectSession.projectContext, currentCustomNodeGraphEffect.definition, currentCustomNodeGraphEffect.name, currentCustomNodeGraphEffect.nodeMetadata);
	} finally {
		exporting.value = false;
	}
}

let disposeEffectPicker: (() => void) | null = null;
onBeforeUnmount(() => disposeEffectPicker?.());

function showAddEffectNodeMenu() {
	const entry = registration.value;
	if (entry == null) return;
	disposeEffectPicker?.();
	const { dispose } = ui.popup(GsEffectPicker, { parentCustomNodeGraphEffectId: entry.id }, {
		chosen: effect => {
			if (projectSession.projectContext.getCustomNodeGraphEffectById(entry.id) == null) return;
			stateManager.commit('createCustomNodeGraphEffectEffectNode', { customNodeGraphEffect: { customNodeGraphEffectId: entry.id }, effectSource: effect.effectSource,
																																																																		connectionMode: preferences.s.customNodeGraphEffectAutoConnectOnNodeAdd ? 'appendToPrimaryOutput' : 'none',
																																																																		connectionTypePolicy: preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch' });
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
