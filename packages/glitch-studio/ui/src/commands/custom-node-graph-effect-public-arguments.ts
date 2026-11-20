import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { createTimelineParameterDefaultBinding, isTimelineImageInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { prepareProjectEffectPlacementChanges } from './project-effect-placements.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';

type ArgumentBinding = CustomNodeGraphEffectParameterBinding | TimelineEffectParameterBinding;
type ArgumentBindingContext = {
	usesTextureInput(binding: ArgumentBinding): boolean;
	createDefaultBinding(definition: ParameterDefinition): ReturnType<typeof createDefaultParameterBinding>;
};
type UpdateArgument = <Binding extends ArgumentBinding>(binding: Binding, context: ArgumentBindingContext) => Binding | null;

/** 配置を調べる前に、型や接続可否が変わった箇所だけを選ぶ。値・UI・enumの選択肢の編集ではこの走査で止める。 */
function createArgumentUpdate(previous: ParameterDefinition, next: ParameterDefinition): UpdateArgument | null {
	if (previous.dataType.kind !== next.dataType.kind) return () => null;
	if (isParameterType(previous, 'array') && isParameterType(next, 'array')) {
		const element = getArrayElementDefinition(next);
		const updateElement = createArgumentUpdate(getArrayElementDefinition(previous), element);
		if (updateElement == null) return null;
		return (binding, context) => {
			if (binding.inputSource !== 'literal') return null;
			// 配列要素のIDは維持し、ツリー内の無効なBindingにはその位置の既定値を明示する。
			const value = (binding.value as ParameterArrayElement<ArgumentBinding>[]).map(entry => ({
				...entry, binding: updateElement(entry.binding, context) ?? context.createDefaultBinding(element),
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
		return (binding, context) => {
			if (binding.inputSource !== 'literal') return null;
			const previousValues = binding.value as Record<string, ArgumentBinding>;
			const value = Object.fromEntries(fields.map(({ key, definition, update }) => {
				const previousValue = previousValues[key];
				const field = previousValue != null && update != null ? update(previousValue, context) : previousValue;
				return [key, field ?? context.createDefaultBinding(definition)];
			}));
			return { ...binding, value };
		};
	}
	if (previous.canNode === true && next.canNode !== true) return (binding, context) => context.usesTextureInput(binding) ? null : binding;
	return null;
}

/** 定義の変更と利用側の引数を同じUndo/Redoとレンダラーの同期に含める。 */
export function includeCustomNodeGraphEffectPublicArgumentChanges(
	state: ProjectState,
	target: CustomNodeGraphEffectTarget,
	parameterId: string,
	prepared: PreparedCommand<ProjectState, AppStateChange>,
	replacement: { previous: ParameterDefinition; next: ParameterDefinition } | null,
): PreparedCommand<ProjectState, AppStateChange> {
	const definitionChange = prepared.change;
	if (definitionChange == null) return prepared;
	const updateArgument = replacement == null ? () => null : createArgumentUpdate(replacement.previous, replacement.next);
	if (updateArgument == null) return prepared;

	const prepareArgumentChange = <Placement, Binding extends ArgumentBinding>(
		placement: Placement, getArguments: (placement: Placement) => Record<string, Binding>, context: ArgumentBindingContext,
	) => {
		const values = getArguments(placement);
		if (!Object.hasOwn(values, parameterId)) return null;
		const before = values[parameterId];
		const after = updateArgument(before, context);
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
		node: 'customNodeGraphEffectId' in target ? (node, containingCustomNodeGraphEffect) => {
			if (node.effectSource.type !== 'customNodeGraphEffectReference' || node.effectSource.id !== target.customNodeGraphEffectId) return null;
			return prepareArgumentChange(node, current => current.params, {
				usesTextureInput: binding => binding.inputSource === 'node' || (binding.inputSource === 'customNodeGraphEffectPublicParameterReference'
					&& containingCustomNodeGraphEffect.paramDefs[binding.parameterId]?.canNode === true),
				createDefaultBinding: createDefaultParameterBinding,
			});
		} : undefined,
		layerArguments(layer, sceneId) {
			const usesDefinition = 'customNodeGraphEffectId' in target
				? layer.effectSource.type === 'customNodeGraphEffectReference' && layer.effectSource.id === target.customNodeGraphEffectId
				: sceneId === target.sceneId && layer.id === target.layerId;
			return usesDefinition ? prepareArgumentChange(layer, current => current.effectParamValues, {
				usesTextureInput: isTimelineImageInputBinding,
				createDefaultBinding: createTimelineParameterDefaultBinding,
			}) : null;
		},
	});
	if (placementChanges.changes.length === 0) return prepared;
	return { ...prepared, change: {
		changes: [...definitionChange.changes, ...placementChanges.changes],
		apply(current) { definitionChange.apply(current); placementChanges.apply(current); },
		revert(current) { definitionChange.revert(current); placementChanges.revert(current); },
	} };
}
