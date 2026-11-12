import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { createParameterClipboard, createVisualModuleClipboardSource, parseParameterClipboard, prepareParameterBindingPaste, prepareProjectParameterPaste, resolveProjectClipboardTarget } from './parameter-clipboard.ts';
import { clipboardText } from './clipboard-text.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { VisualModuleArgumentBindings, VisualModulePublicParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ClipboardTextAccess } from './clipboard-text.ts';
import type { ProjectParameterClipboardTarget } from './parameter-clipboard.ts';
import type { ProjectContext } from '../Project.ts';

/** 読み取り前の対象を捕捉し、終了済みのプロジェクトや削除・再作成された対象へ遅延適用しない。 */
export async function handleProjectParameterClipboard(
	context: ProjectContext,
	requestedTarget: ProjectParameterClipboardTarget,
	operation: 'copy' | 'paste',
	isActive: () => boolean,
	clipboard: ClipboardTextAccess = clipboardText,
): Promise<void> {
	const projectId = context.id;
	if (context.isDisposed || !isActive()) return;
	const target = deepClone(requestedTarget);
	const state = context.stateManager.state;
	let initial;
	try { initial = resolveProjectClipboardTarget(state, projectId, target); } catch { return; }
	if (operation === 'copy') {
		const data = createParameterClipboard(initial.def, initial.value, initial.context.source);
		await clipboard.writeText(JSON.stringify(data));
		return;
	}
	const initialContext = initial.context;
	const originalOwner = initialContext.kind === 'node' ? initialContext.visualModule.nodes.find(node => node.id === initialContext.nodeId)
		: initialContext.kind === 'customParameter' ? initialContext.visualModule.customParameterDefs.find(definition => definition.id === target.paramPath[0]) : initialContext.layer;
	const originalType = deepClone(initial.def.dataType);
	const data = parseParameterClipboard(await clipboard.readText());
	// 別名保存でIDが変わると参照の貼り付け可否も変わるため、読み取り開始時のIDとは照合する。
	if (data == null || !isActive() || context.isDisposed || context.id !== projectId) return;
	try {
		const current = resolveProjectClipboardTarget(state, projectId, target);
		const currentContext = current.context;
		const currentOwner = currentContext.kind === 'node' ? currentContext.visualModule.nodes.find(node => node.id === currentContext.nodeId)
			: currentContext.kind === 'customParameter' ? currentContext.visualModule.customParameterDefs.find(definition => definition.id === target.paramPath[0]) : currentContext.layer;
		if (currentOwner !== originalOwner || !areDataTypesEqual(originalType, current.def.dataType)) return;
	} catch { return; }
	if (prepareProjectParameterPaste(state, projectId, target, data) == null) return;
	context.stateManager.commit('pasteParameter', { target, projectId, clipboard: data });
}

/** Live Previewの引数は保存状態・履歴を持たないため、共通の検証後に呼び出し側へ返す。 */
export async function handlePreviewParameterClipboard(
	context: ProjectContext,
	visualModuleId: string,
	requestedPath: ParamPath,
	operation: 'copy' | 'paste',
	values: () => VisualModuleArgumentBindings,
	isActive: () => boolean,
	apply: (id: VisualModulePublicParameterId, binding: ValueParameterBinding) => void,
	clipboard: ClipboardTextAccess = clipboardText,
): Promise<void> {
	const projectId = context.id;
	if (context.isDisposed || !isActive()) return;
	const state = context.stateManager.state;
	const visualModule = state.visualModules.value.find(candidate => candidate.id === visualModuleId);
	if (visualModule == null) return;
	const path: ParamPath = [...requestedPath];
	const rootDefinition = visualModule.paramDefs.find(definition => definition.id === path[0]);
	if (rootDefinition == null) return;
	const rootId = rootDefinition.id;

	const resolve = () => {
		const definition = visualModule.paramDefs.find(candidate => candidate.id === rootId);
		if (definition == null) throw new Error('Preview parameter not found');
		const draft = { [rootId]: deepClone(values()[rootId] ?? definition.defaultValue) };
		return { draft, parameter: resolveParameter<ValueParameterBinding>({ [rootId]: definition }, draft, path) };
	};

	let initial;
	try { initial = resolve(); } catch { return; }
	const source = { ...createVisualModuleClipboardSource(projectId, { visualModuleId }, visualModule), localAutomationGraphIds: [] };
	if (operation === 'copy') {
		await clipboard.writeText(JSON.stringify(createParameterClipboard(initial.parameter.def, initial.parameter.value, source)));
		return;
	}
	const originalType = deepClone(initial.parameter.def.dataType);
	const data = parseParameterClipboard(await clipboard.readText());
	if (data == null || !isActive() || context.isDisposed || context.id !== projectId
		|| !state.visualModules.value.includes(visualModule)) return;
	let nextRoot: ValueParameterBinding;
	try {
		const current = resolve();
		if (!areDataTypesEqual(originalType, current.parameter.def.dataType)) return;
		const binding = prepareParameterBindingPaste(current.parameter.def, data, {
			kind: 'preview', state, visualModule, source,
		});
		if (binding == null) return;
		current.parameter.setValue(binding as ValueParameterBinding);
		nextRoot = current.draft[rootId];
	} catch { return; }
	apply(rootId, nextRoot);
}
