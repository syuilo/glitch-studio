import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { preferences } from '@/preferences.ts';
import { findCustomNodeGraphEffectOwner } from './custom-node-graph-effect-target.ts';
import { getCustomNodeGraphEffectView } from './custom-node-graph-effect-view.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { createParameterClipboard, parseParameterClipboard, prepareParameterBindingPaste, prepareProjectParameterPaste, resolveProjectClipboardTarget } from './parameter-clipboard.ts';
import { clipboardText } from './clipboard-text.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { CustomNodeGraphEffectParameterBinding, CustomNodeGraphEffectValueParameterBinding } from '@/types/custom-node-graph-effect-view.ts';
import type { EditableTimelineParameterBinding } from '../types/parameter-edit.ts';
import type { ClipboardTextAccess } from './clipboard-text.ts';
import type { ProjectParameterClipboardTarget } from './parameter-clipboard.ts';
import type { ProjectContext } from '../Project.ts';
import type { EffectLivePreviewSource } from '../types/effect-live-preview.ts';
import type { ParameterClipboardSource } from './parameter-clipboard.ts';

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
		// 未保存の配列では、定義の更新後に同じ位置から別の要素へ同じIDが振られる。
		// 貼り付け前の既定値を確かめ、表示時に指定した要素へ編集を適用できる場合だけ続ける。
		const rootId = target.paramPath[0];
		if (initial.before == null && initial.hasArrayElementInPath && !deepEqual(initial.draft[rootId], current.draft[rootId])) return;
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
	effectSource: EffectLivePreviewSource,
	requestedPath: ParamPath,
	operation: 'copy' | 'paste',
	readArgument: (id: string) => { binding: ValueParameterBinding | null; followsDefault: boolean },
	isActive: () => boolean,
	apply: (id: string, binding: ValueParameterBinding) => void,
	clipboard: ClipboardTextAccess = clipboardText,
): Promise<void> {
	if (context.isDisposed || !isActive()) return;
	const state = context.stateManager.state;
	const customNodeGraphEffectEntry = effectSource.type === 'customNodeGraphEffectReference'
		? state.customNodeGraphEffects.value.find(candidate => candidate.id === effectSource.id) : null;
	const customShaderEffectEntry = effectSource.type === 'customShaderEffectReference'
		? state.customShaderEffects.value.find(candidate => candidate.id === effectSource.id) : null;
	if (customNodeGraphEffectEntry == null && customShaderEffectEntry == null) return;
	const readCustomNodeGraphEffect = () => customNodeGraphEffectEntry == null ? null : getCustomNodeGraphEffectView(customNodeGraphEffectEntry, state);
	const path: ParamPath = [...requestedPath];
	const rootId = path[0] as string;

	const resolve = () => {
		const customNodeGraphEffect = readCustomNodeGraphEffect();
		const definition = customNodeGraphEffect?.paramDefs.find(candidate => candidate.id === rootId) ?? customShaderEffectEntry?.definition.paramDefs[rootId];
		if (definition == null) throw new Error('Preview parameter not found');
		const { binding, followsDefault } = readArgument(rootId);
		const draft = { [rootId]: binding == null ? createDefaultParameterBinding(definition) : deepClone(binding) };
		return { draft, parameter: resolveParameter<ValueParameterBinding>({ [rootId]: definition }, draft, path), followsDefault: binding == null || followsDefault };
	};

	let initial;
	try { initial = resolve(); } catch { return; }
	const source: ParameterClipboardSource = {
		projectSessionId,
		owner: effectSource.type === 'customNodeGraphEffectReference'
			? { kind: 'customNodeGraphEffect', target: { customNodeGraphEffectId: effectSource.id } }
			: { kind: 'customShaderEffect', customShaderEffectId: effectSource.id },
		localAutomationGraphIds: [],
	};
	if (operation === 'copy') {
		await clipboard.writeText(JSON.stringify(createParameterClipboard(initial.parameter.def, initial.parameter.value, source)));
		return;
	}
	const originalType = deepClone(initial.parameter.def.dataType);
	// 未編集のプレビュー引数も定義の更新に追従する。表示用に展開した既定値を読み取り前に捕捉する。
	const initialRoot = initial.draft[rootId];
	const usesDefaultArrayElement = initial.followsDefault && initial.parameter.hasArrayElementInPath;
	const data = parseParameterClipboard(await clipboard.readText());
	if (data == null || !isActive() || context.isDisposed) return;
	if (customNodeGraphEffectEntry != null && !state.customNodeGraphEffects.value.includes(customNodeGraphEffectEntry)) return;
	if (customShaderEffectEntry != null && !state.customShaderEffects.value.includes(customShaderEffectEntry)) return;
	let nextRoot: ValueParameterBinding;
	try {
		const current = resolve();
		if (!areDataTypesEqual(originalType, current.parameter.def.dataType)) return;
		if (usesDefaultArrayElement && !deepEqual(initialRoot, current.draft[rootId])) return;
		const binding = prepareParameterBindingPaste(current.parameter.def, data, {
			kind: 'preview', state, customNodeGraphEffect: readCustomNodeGraphEffect(), source,
		});
		if (binding == null) return;
		current.parameter.setValue(binding as ValueParameterBinding);
		nextRoot = current.draft[rootId];
	} catch { return; }
	apply(rootId, nextRoot);
}
