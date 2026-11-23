import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { isTimelineImageInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { prepareProjectEffectPlacementChanges } from './project-effect-placements.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { NodesEffectTarget } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';
import type { NodesEffectParameterBinding } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';

type ArgumentBinding = NodesEffectParameterBinding | TimelineEffectParameterBinding;
type UsesTextureInput = (binding: ArgumentBinding) => boolean;
type UpdateArgument = <Binding extends ArgumentBinding>(binding: Binding, usesTextureInput: UsesTextureInput) => Binding | null;

/** 配置を調べる前に、型や接続可否が変わった箇所だけを選ぶ。値・UI・enumの選択肢の編集ではこの走査で止める。 */
function createArgumentUpdate(previous: ParameterDefinition, next: ParameterDefinition): UpdateArgument | null {
	if (previous.dataType.kind !== next.dataType.kind) return () => null;
	if (isParameterType(previous, 'array') && isParameterType(next, 'array')) {
		const element = getArrayElementDefinition(next);
		const updateElement = createArgumentUpdate(getArrayElementDefinition(previous), element);
		if (updateElement == null) return null;
		return (binding, usesTextureInput) => {
			if (binding.inputSource !== 'literal') return null;
			// 配列要素のIDは維持し、ツリー内の無効なBindingにはその位置の既定値を明示する。
			const value = (binding.value as ParameterArrayElement<ArgumentBinding>[]).map(entry => ({
				...entry, binding: updateElement(entry.binding, usesTextureInput) ?? createDefaultParameterBinding(element),
			}));
			return { ...binding, value };
		};
	}
	if (isParameterType(previous, 'struct') && isParameterType(next, 'struct')) {
		const previousFields = getStructFieldDefinitions(previous);
		const fields = Object.entries(getStructFieldDefinitions(next)).map(([key, definition]) => ({
			key, definition, update: Object.hasOwn(previousFields, key) ? createArgumentUpdate(previousFields[key], definition) : () => null,
		}));
		if (fields.length === Object.keys(previousFields).length && fields.every(field => field.update == null)) return null;
		return (binding, usesTextureInput) => {
			if (binding.inputSource !== 'literal') return null;
			const previousValues = binding.value as Record<string, ArgumentBinding>;
			const value = Object.fromEntries(fields.map(({ key, definition, update }) => {
				const previousValue = previousValues[key];
				const field = previousValue != null && update != null ? update(previousValue, usesTextureInput) : previousValue;
				return [key, field ?? createDefaultParameterBinding(definition)];
			}));
			return { ...binding, value };
		};
	}
	if (previous.canNode === true && next.canNode !== true) return (binding, usesTextureInput) => usesTextureInput(binding) ? null : binding;
	return null;
}

/** 定義の変更と利用側の引数を同じUndo/Redoとレンダラーの同期に含める。 */
export function includeNodesEffectPublicArgumentChanges(
	state: ProjectState,
	target: NodesEffectTarget,
	parameterId: string,
	prepared: PreparedCommand<ProjectState, AppStateChange>,
	replacement: { previous: ParameterDefinition; next: ParameterDefinition } | null,
): PreparedCommand<ProjectState, AppStateChange> {
	const definitionChange = prepared.change;
	if (definitionChange == null) return prepared;
	const updateArgument = replacement == null ? () => null : createArgumentUpdate(replacement.previous, replacement.next);
	if (updateArgument == null) return prepared;

	const prepareArgumentChange = <Placement, Binding extends ArgumentBinding>(
		placement: Placement, getArguments: (placement: Placement) => Record<string, Binding>, usesTextureInput: UsesTextureInput,
	) => {
		const values = getArguments(placement);
		if (!Object.hasOwn(values, parameterId)) return null;
		const before = values[parameterId];
		const after = updateArgument(before, usesTextureInput);
		if (deepEqual(before, after)) return null;
		const previousBinding = deepClone(before);
		const nextBinding = deepClone(after);
		return (current: Placement, restore: boolean) => {
			const currentValues = getArguments(current);
			const binding = restore ? previousBinding : nextBinding;
			if (binding == null) delete currentValues[parameterId];
			else currentValues[parameterId] = deepClone(binding);
		};
	};

	const placementChanges = prepareProjectEffectPlacementChanges(state, {
		node: 'nodesEffectId' in target ? (node, containingNodesEffect) => {
			if (node.effectSource.type !== 'nodesEffectReference' || node.effectSource.id !== target.nodesEffectId) return null;
			return prepareArgumentChange(node, current => current.params, binding => binding.inputSource === 'node'
				|| (binding.inputSource === 'nodesEffectPublicParameterReference'
					&& containingNodesEffect.paramDefs[binding.parameterId]?.canNode === true));
		} : undefined,
		layerArguments(layer, sceneId) {
			const usesDefinition = 'nodesEffectId' in target
				? layer.effectSource.type === 'nodesEffectReference' && layer.effectSource.id === target.nodesEffectId
				: sceneId === target.sceneId && layer.id === target.layerId;
			return usesDefinition ? prepareArgumentChange(layer, current => current.effectParamValues, isTimelineImageInputBinding) : null;
		},
	});
	if (placementChanges.changes.length === 0) return prepared;
	return { ...prepared, change: {
		changes: [...definitionChange.changes, ...placementChanges.changes],
		apply(current) { definitionChange.apply(current); placementChanges.apply(current); },
		revert(current) { definitionChange.revert(current); placementChanges.revert(current); },
	} };
}
