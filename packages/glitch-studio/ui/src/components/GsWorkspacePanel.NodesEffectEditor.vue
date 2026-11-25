<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button class="_button" style="padding: 4px 6px;" @click="showSwitchMenu"><i class="ti ti-chevron-down"></i> {{ nodesEffect?.name ?? '' }} [{{ prettyId(nodesEffect?.id ?? '') }}]</button>
		<GsButton
			v-if="nodesEffect != null"
			v-tooltip="showShortLabels ? i18n.ts._NodesEffect.LivePreview : null"
			style="margin-left: auto;"
			:primary="previewPlayback.livePreviewNodesEffectId.value === nodesEffect.id"
			@click="previewNodesEffectLivePreview"
		>
			{{ showShortLabels ? 'Pv' : i18n.ts.Preview }}
		</GsButton>
		<span v-if="previewPlayback.livePreviewNodesEffectId.value === nodesEffect?.id && projectSession.effectLivePreviewManagerController.preparationStatus.value?.type === 'loading'">{{ i18n.ts.Loading }}</span>
	</div>

	<GsNodesEffectEditor
		v-if="nodesEffect"
		:key="nodesEffect.id"
		:class="$style.editor"
		:nodesEffect="nodesEffect"
		:nodesEffectName="nodesEffect.name"
		:previewTarget="{ nodesEffectId: nodesEffect.id }"
		:assetDropActions="assetDropActions"
		:exporting="exporting"
		@edit="onEdit"
		@rename="renameCurrentNodesEffect"
		@requestAddEffectNode="showAddEffectNodeMenu"
		@requestExport="exportCurrentNodesEffect"
	>
		<template #preview>
			<div :class="$style.previewParams">
				<GsEffectLivePreviewResolution
					:key="nodesEffect.id"
					:effectSource="{ type: 'nodesEffectReference', id: nodesEffect.id }"
					@activate="previewNodesEffectLivePreview"
				/>
				<GsEffectLivePreviewTimeFactor/>
				<GsEffectLivePreviewInput
					:effectSource="{ type: 'nodesEffectReference', id: nodesEffect.id }"
					@activate="previewNodesEffectLivePreview"
				/>
				<!-- 構造化された公開パラメータのプレビュー編集は未対応。 -->
				<template v-for="paramDef of nodesEffect.paramDefs" :key="paramDef.id">
					<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array'">{{ paramDef.ui.label }}{{ i18n.ts._TimelineLayer.EditingUnsupported }}</div>
					<GsVisualParam
						v-else
						previewMediaInputEnabled
						:availableVariables="EFFECT_LIVE_PREVIEW_VAR_DEFS"
						:paramPath="[paramDef.id]"
						:functionCurves="[]"
						:projectFunctionCurves="stateManager.state.functionCurves.value"
						:paramDef="paramDef"
						:paramValue="previewParamValues[paramDef.id]"
						@edit="onPreviewParamEdit"
					/>
				</template>
			</div>
		</template>
	</GsNodesEffectEditor>
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
import { canUseEffectLivePreviewInput, isEffectLivePreviewMediaBinding } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';
import GsNodesEffectEditor from './GsNodesEffectEditor.vue';
import GsEffectLivePreviewInput from './GsEffectLivePreviewInput.vue';
import GsEffectLivePreviewResolution from './GsEffectLivePreviewResolution.vue';
import GsEffectLivePreviewTimeFactor from './GsEffectLivePreviewTimeFactor.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsEffectPicker from './GsEffectPicker.vue';
import GsButton from './common/GsButton.vue';
import type { EffectLivePreviewParameterBinding } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';
import type { ProjectNodesEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { NodesEffectParamDef } from '@/types/nodes-effect-view.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { NodesEffectEdit } from '@/types/nodes-effect-editor.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { getNodesEffectView } from '@/utility/nodes-effect-view.ts';
import { i18n } from '@/i18n.ts';
import { useProjectSession } from '@/project-session.ts';
import * as ui from '@/ui.ts';
import { commitNodesEffectEdit } from '@/utility/nodes-effect-edit.ts';
import { handleProjectParameterClipboard, handlePreviewParameterClipboard } from '@/utility/parameter-clipboard-actions.ts';
import { exportPortableNodesEffectFile } from '@/utility/portable-nodes-effect-file.ts';
import { exportNodesEffectFile, importNodesEffectFile } from '@/utility/nodes-effect-file.ts';
import { createNodesEffectDropActions } from '@/utility/nodes-effect-drop-actions.ts';
import { preferences } from '@/preferences.ts';
import { editEffectLivePreviewParameter } from '@/utility/effect-live-preview-parameter.ts';
import { previewParameterContextKey } from '@/utility/preview-parameter-editing.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';

const projectSession = useProjectSession();

const { previewPlayback } = projectSession;
const { stateManager } = projectSession.projectContext;
const showShortLabels = preferences.r.showShortLabels;

const props = defineProps<{ panel: WorkspacePanel }>();
const workspaceController = inject(workspaceControllerKey)!;
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

const exporting = ref(false);
const importing = ref(false);
const selectedNodesEffectId = ref<ProjectNodesEffect['id'] | null>(null);
const registration = computed(() => stateManager.state.nodesEffects.value.find(currentNodesEffect => currentNodesEffect.id === selectedNodesEffectId.value)
	?? stateManager.state.nodesEffects.value[0] ?? null);
const nodesEffect = computed(() => {
	const entry = registration.value;
	return entry == null ? null : { ...entry, ...getNodesEffectView(entry, stateManager.state) };
});
const assetDropActions = computed(() => {
	const currentNodesEffect = nodesEffect.value;
	return currentNodesEffect == null ? null : createNodesEffectDropActions({
		context: projectSession.projectContext,
		projectSessionId: projectSession.id,
		target: { nodesEffectId: currentNodesEffect.id },
		isActive: () => !disposed && nodesEffect.value === currentNodesEffect,
		revealAssets: () => workspaceController.revealPanel({ contentType: 'assets', sourcePanelId: props.panel.id }),
	});
});

// 選択した定義が削除・置換されても、常に現在のプロジェクトから対象を解決する。
watch(() => nodesEffect.value?.id, id => {
	selectedNodesEffectId.value = id ?? null;
}, { immediate: true });

const previewParamValues = ref<Record<string, EffectLivePreviewParameterBinding>>({});
const editedPreviewParamIds = new Set<string>();

function synchronizePreviewParameters(id: string, activate: boolean) {
	const overrides = Object.fromEntries([...editedPreviewParamIds].map(key => [key, previewParamValues.value[key]]));
	projectSession.storeNodesEffectPreviewParamValues(id, overrides);
	if (activate || previewPlayback.livePreviewNodesEffectId.value === id) {
		previewPlayback.updateEffectLivePreviewParamValues({ type: 'nodesEffectReference', id }, overrides);
	}
}

// Preview Paramsは保存データではないため、取消しだけを既存の一時値へ適用する。
provide(previewParameterContextKey, {
	scope: computed(() => nodesEffect.value == null ? null : {
		kind: 'livePreview', effectSource: { type: 'nodesEffectReference', id: nodesEffect.value.id },
	} as const),
	label: computed(() => nodesEffect.value?.name ?? ''),
	beginLivePreviewEdit(path) {
		const nodesEffectId = nodesEffect.value?.id ?? null;
		const id = path[0] as string;
		const before = deepClone(previewParamValues.value[id]);
		const wasEdited = editedPreviewParamIds.has(id);
		let active = true;
		return {
			get active() { return active && nodesEffect.value?.id === nodesEffectId; },
			update(edit) { if (active && nodesEffect.value?.id === nodesEffectId) onPreviewParamEdit({ ...edit, paramPath: path }); },
			finish() { active = false; },
			cancel() {
				if (!active || nodesEffect.value?.id !== nodesEffectId) return;
				active = false;
				previewParamValues.value[id] = before;
				if (!wasEdited) editedPreviewParamIds.delete(id);
				if (nodesEffect.value != null) synchronizePreviewParameters(nodesEffect.value.id, true);
			},
		};
	},
});
let previewNodesEffectId: string | null = null;
let previewParamTypes = new Map<string, NodesEffectParamDef['dataType']>();

watch(nodesEffect, currentNodesEffect => {
	const id = currentNodesEffect?.id ?? null;
	const switched = id !== previewNodesEffectId;
	if (switched) {
		editedPreviewParamIds.clear();
		previewParamValues.value = id == null ? {} : { ...projectSession.getNodesEffectPreviewParamValues(id) };
		for (const key of Object.keys(previewParamValues.value)) editedPreviewParamIds.add(key);
	}
	const values: Record<string, EffectLivePreviewParameterBinding> = {};
	for (const def of currentNodesEffect?.paramDefs ?? []) {
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
	previewNodesEffectId = currentNodesEffect?.id ?? null;
	previewParamTypes = new Map((currentNodesEffect?.paramDefs ?? []).map(def => [def.id, def.dataType]));
	if (id != null) synchronizePreviewParameters(id, false);
}, { deep: true, immediate: true });

function onPreviewParamEdit(event: ParamEdit) {
	if (event.kind === 'copy' || event.kind === 'paste') {
		const currentNodesEffect = nodesEffect.value;
		if (currentNodesEffect == null) return;
		void handlePreviewParameterClipboard(projectSession.projectContext, projectSession.id, { type: 'nodesEffectReference', id: currentNodesEffect.id }, event.paramPath, event.kind,
			id => ({ binding: previewParamValues.value[id] ?? null, followsDefault: !editedPreviewParamIds.has(id) }),
			() => !disposed && nodesEffect.value === currentNodesEffect,
			(id, binding) => {
				previewParamValues.value[id] = binding;
				editedPreviewParamIds.add(id);
				synchronizePreviewParameters(currentNodesEffect.id, true);
			}).catch(error => ui.alert({ type: 'error', text: String(error) }));
		return;
	}
	const rootDefinition = nodesEffect.value?.paramDefs.find(def => def.id === event.paramPath[0]);
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
	if (nodesEffect.value != null) synchronizePreviewParameters(nodesEffect.value.id, true);
}

function previewNodesEffectLivePreview() {
	if (nodesEffect.value == null) return;
	projectSession.startNodesEffectLivePreview(nodesEffect.value.id);
}

function showSwitchMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: i18n.ts.New,
		icon: 'ti ti-plus',
		action: addNodesEffect,
	}, {
		text: `${i18n.ts._NodesEffect.Import}...`,
		icon: 'ti ti-download',
		action: importNodesEffect,
	}, {
		type: 'divider',
	}, ...stateManager.state.nodesEffects.value.map(_nodesEffect => ({
		text: _nodesEffect.name,
		active: _nodesEffect.id === nodesEffect.value?.id,
		action: () => {
			selectedNodesEffectId.value = _nodesEffect.id;
		},
	}))], ev.currentTarget ?? ev.target);
}

function addNodesEffect() {
	const target = stateManager.commit('createNodesEffect', {});
	selectedNodesEffectId.value = target.nodesEffectId;
}

async function importNodesEffect() {
	if (importing.value) return;
	importing.value = true;
	try {
		const id = await importNodesEffectFile(projectSession.projectContext);
		if (id != null) selectedNodesEffectId.value = id;
	} finally {
		importing.value = false;
	}
}

function renameCurrentNodesEffect(name: string) {
	const currentNodesEffect = nodesEffect.value;
	if (currentNodesEffect == null || currentNodesEffect.name === name) return;
	stateManager.commit('setNodesEffectName', { target: { nodesEffectId: currentNodesEffect.id }, name });
}

async function exportCurrentNodesEffect(format: 'gsne' | 'web' = 'gsne') {
	const currentNodesEffect = nodesEffect.value;
	if (currentNodesEffect == null || exporting.value) return;
	exporting.value = true;
	try {
		if (format === 'web') await exportPortableNodesEffectFile(projectSession, currentNodesEffect.definition, currentNodesEffect.name, currentNodesEffect.nodeMetadata);
		else await exportNodesEffectFile(projectSession.projectContext, currentNodesEffect.definition, currentNodesEffect.name, currentNodesEffect.nodeMetadata);
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
	const { dispose } = ui.popup(GsEffectPicker, { parentNodesEffectId: entry.id }, {
		chosen: effect => {
			if (projectSession.projectContext.getNodesEffectById(entry.id) == null) return;
			stateManager.commit('createNodesEffectEffectNode', {
				nodesEffect: { nodesEffectId: entry.id },
				effectSource: effect.effectSource,
				connectionMode: preferences.s.nodesEffectAutoConnectOnNodeAdd ? 'appendToPrimaryOutput' : 'none',
				connectionTypePolicy: preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch',
			});
		},
		closed: () => {
			dispose();
			if (disposeEffectPicker === dispose) disposeEffectPicker = null;
		},
	}, projectSession);
	disposeEffectPicker = dispose;
}

function onEdit(event: NodesEffectEdit) {
	const currentNodesEffect = nodesEffect.value;
	if (currentNodesEffect == null) return;
	if (event.kind === 'customParameterClipboard') {
		void handleProjectParameterClipboard(projectSession.projectContext, projectSession.id,
			{ kind: 'customParameter', nodesEffectTarget: { nodesEffectId: currentNodesEffect.id }, paramPath: [event.parameterId] },
			event.operation, () => !disposed && nodesEffect.value === currentNodesEffect).catch(error => ui.alert({ type: 'error', text: String(error) }));
		return;
	}
	if (event.kind === 'editNodeParam' && (event.edit.kind === 'copy' || event.edit.kind === 'paste')) {
		void handleProjectParameterClipboard(projectSession.projectContext, projectSession.id,
			{ kind: 'node', nodesEffectTarget: { nodesEffectId: currentNodesEffect.id }, nodeId: event.nodeId, paramPath: event.edit.paramPath },
			event.edit.kind, () => !disposed && nodesEffect.value === currentNodesEffect).catch(error => ui.alert({ type: 'error', text: String(error) }));
		return;
	}
	commitNodesEffectEdit(stateManager, { nodesEffectId: currentNodesEffect.id }, event);
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
