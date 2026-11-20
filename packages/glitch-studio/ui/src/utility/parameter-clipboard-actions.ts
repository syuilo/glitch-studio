import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { preferences } from '@/preferences.ts';
import { findCustomNodeGraphEffectOwner } from './custom-node-graph-effect-target.ts';
import { getCustomNodeGraphEffectView } from './custom-node-graph-effect-view.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { createParameterClipboard, createCustomNodeGraphEffectClipboardSource, parseParameterClipboard, prepareParameterBindingPaste, prepareProjectParameterPaste, resolveProjectClipboardTarget } from './parameter-clipboard.ts';
import { clipboardText } from './clipboard-text.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { CustomNodeGraphEffectArgumentBindings, CustomNodeGraphEffectParameterBinding, CustomNodeGraphEffectValueParameterBinding } from '@/types/custom-node-graph-effect-view.ts';
import type { EditableTimelineParameterBinding } from '../types/parameter-edit.ts';
import type { ClipboardTextAccess } from './clipboard-text.ts';
import type { ProjectParameterClipboardTarget } from './parameter-clipboard.ts';
import type { ProjectContext } from '../Project.ts';

/** 読み取り前の対象を捕捉し、終了済みのプロジェクトや削除・再作成された対象へ遅延適用しない。 */
export async function handleProjectParameterClipboard(
	context: ProjectContext,
	projectSessionId: string,
	requestedTarget: ProjectParameterClipboardTarget,
	operation: 'copy' | 'paste',
	isActive: () => boolean,
	clipboard: ClipboardTextAccess = clipboardText,
): Promise<void> {
	if (context.isDisposed || !isActive()) return;
	const target = deepClone(requestedTarget);
	const state = context.stateManager.state;
	let initial;
	try { initial = resolveProjectClipboardTarget(state, projectSessionId, target); } catch { return; }
	if (operation === 'copy') {
		const data = createParameterClipboard(initial.def, initial.value, initial.context.source);
		await clipboard.writeText(JSON.stringify(data));
		return;
	}
	const findOwner = () => {
		if (target.kind === 'timeline') return null;
		const entry = findCustomNodeGraphEffectOwner(state, target.customNodeGraphEffectTarget);
		if (entry == null) return null;
		const definition = 'definition' in entry ? entry.definition : entry.customNodeGraphEffect;
		return target.kind === 'node' ? definition.nodes.find(node => node.id === target.nodeId) : definition.customParameterDefs?.[target.paramPath[0]];
	};
	const originalOwner = initial.context.kind === 'timeline' ? initial.context.layer : findOwner();
	const originalType = deepClone(initial.def.dataType);
	const data = parseParameterClipboard(await clipboard.readText());
	if (data == null || !isActive() || context.isDisposed) return;
	try {
		const current = resolveProjectClipboardTarget(state, projectSessionId, target);
		const currentOwner = current.context.kind === 'timeline' ? current.context.layer : findOwner();
		if (currentOwner !== originalOwner || !areDataTypesEqual(originalType, current.def.dataType)) return;
	} catch { return; }
	const connectionTypePolicy = preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch';
	const update = prepareProjectParameterPaste(state, projectSessionId, target, data, connectionTypePolicy);
	if (update == null) return;
	// クリップボードの形式・セッション由来の参照はUI境界で解決する。
	// Commandへは編集対象と完成したBindingだけを渡し、他の呼び出し元と同じ検証を通す。
	const parameterPath: ParamPath = [target.paramPath[0]];
	if (target.kind === 'node') {
		context.stateManager.commit('replaceCustomNodeGraphEffectNodeParameterBinding', {
			target: { customNodeGraphEffect: target.customNodeGraphEffectTarget, nodeId: target.nodeId }, parameterPath,
			binding: update.after as CustomNodeGraphEffectParameterBinding, connectionTypePolicy,
		});
	} else if (target.kind === 'customParameter') {
		context.stateManager.commit('replaceCustomNodeGraphEffectCustomParameterBinding', {
			target: { customNodeGraphEffect: target.customNodeGraphEffectTarget, parameterId: parameterPath[0] as string },
			binding: update.after as CustomNodeGraphEffectValueParameterBinding,
		});
	} else {
		context.stateManager.commit('replaceTimelineLayerParameterBinding', {
			sceneId: target.sceneId, layerId: target.layerId,
			parameterGroup: target.parameterTarget,
			parameterPath, binding: update.after as EditableTimelineParameterBinding, connectionTypePolicy,
		});
	}
}

/** Live Previewの引数は保存状態・履歴を持たないため、共通の検証後に呼び出し側へ返す。 */
export async function handlePreviewParameterClipboard(
	context: ProjectContext,
	projectSessionId: string,
	customNodeGraphEffectId: string,
	requestedPath: ParamPath,
	operation: 'copy' | 'paste',
	values: () => CustomNodeGraphEffectArgumentBindings,
	isActive: () => boolean,
	apply: (id: string, binding: ValueParameterBinding) => void,
	clipboard: ClipboardTextAccess = clipboardText,
): Promise<void> {
	if (context.isDisposed || !isActive()) return;
	const state = context.stateManager.state;
	const entry = state.customNodeGraphEffects.value.find(candidate => candidate.id === customNodeGraphEffectId);
	if (entry == null) return;
	const customNodeGraphEffect = getCustomNodeGraphEffectView(entry, state);
	const path: ParamPath = [...requestedPath];
	const rootDefinition = customNodeGraphEffect.paramDefs.find(definition => definition.id === path[0]);
	if (rootDefinition == null) return;
	const rootId = rootDefinition.id;

	const resolve = () => {
		const definition = getCustomNodeGraphEffectView(entry, state).paramDefs.find(candidate => candidate.id === rootId);
		if (definition == null) throw new Error('Preview parameter not found');
		const current = values()[rootId];
		const draft = { [rootId]: current == null ? createDefaultParameterBinding(definition) : deepClone(current) };
		return { draft, parameter: resolveParameter<ValueParameterBinding>({ [rootId]: definition }, draft, path) };
	};

	let initial;
	try { initial = resolve(); } catch { return; }
	const source = { ...createCustomNodeGraphEffectClipboardSource(projectSessionId, { customNodeGraphEffectId }, customNodeGraphEffect), localAutomationGraphIds: [] };
	if (operation === 'copy') {
		await clipboard.writeText(JSON.stringify(createParameterClipboard(initial.parameter.def, initial.parameter.value, source)));
		return;
	}
	const originalType = deepClone(initial.parameter.def.dataType);
	const data = parseParameterClipboard(await clipboard.readText());
	if (data == null || !isActive() || context.isDisposed
		|| !state.customNodeGraphEffects.value.includes(entry)) return;
	let nextRoot: ValueParameterBinding;
	try {
		const current = resolve();
		if (!areDataTypesEqual(originalType, current.parameter.def.dataType)) return;
		const binding = prepareParameterBindingPaste(current.parameter.def, data, {
			kind: 'preview', state, customNodeGraphEffect: getCustomNodeGraphEffectView(entry, state), source,
		});
		if (binding == null) return;
		current.parameter.setValue(binding as ValueParameterBinding);
		nextRoot = current.draft[rootId];
	} catch { return; }
	apply(rootId, nextRoot);
}
