import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { walkParameters, resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { customShaderEffectReference } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import { getEffectDefinitions } from './project-effects.ts';
import type { ProjectState } from '../Project.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { VisualModule, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';

export function snapshotCustomShaderEffectUsages(state: ProjectState) {
	return deepClone({ visualModules: state.visualModules?.value ?? [], timelineScenes: state.timelineScenes?.value ?? [] });
}

export function isCustomShaderEffectUsed(state: ProjectState, id: string): boolean {
	const reference = customShaderEffectReference(id);
	const layers = (state.timelineScenes?.value ?? []).flatMap(scene => flattenTimelineLayers(scene.layers));
	return layers.some(layer => layer.layerType === 'effect' && layer.effectId === reference)
		|| [...(state.visualModules?.value ?? []), ...layers.flatMap(layer => layer.layerType === 'inlineVisualModule' ? [layer.visualModule] : [])]
			.some(visualModule => visualModule.nodes.some(node => node.type === 'effect' && node.effectId === reference));
}

/** 適用前に複製上で計算し、定義と全使用箇所を同じCommandで交換できるようにする。 */
export function reconcileCustomShaderEffectUsages(state: ProjectState, previous: ProjectCustomShaderEffect, next: ProjectCustomShaderEffect) {
	const usages = snapshotCustomShaderEffectUsages(state);
	const reference = customShaderEffectReference(next.id);
	const definitions = getEffectDefinitions({ customShaderEffects: { value: state.customShaderEffects.value.map(definition => definition.id === next.id ? next : definition) } });
	const previousParameters = new Map(previous.paramDefs.map(parameter => [parameter.id, parameter]));
	const previousOutputs = new Map(previous.outputDefs.map(output => [output.id, output]));
	const outputs = new Map(next.outputDefs.map(output => [output.id, output]));
	const layers = usages.timelineScenes.flatMap(scene => flattenTimelineLayers(scene.layers));
	const visualModules: VisualModule[] = [...usages.visualModules, ...layers.flatMap(layer => layer.layerType === 'inlineVisualModule' ? [layer.visualModule] : [])];
	for (const visualModule of visualModules) {
		const changedNodes = new Set(visualModule.nodes.filter(node => node.type === 'effect' && node.effectId === reference).map(node => node.id));
		if (changedNodes.size === 0) continue;
		for (const node of visualModule.nodes) {
			if (node.type !== 'effect' || node.effectId !== reference) continue;
			node.params = Object.fromEntries(next.paramDefs.map(parameter => {
				const value = node.params[parameter.id];
				const previousParameter = previousParameters.get(parameter.id);
				let compatible = previousParameter?.dataType.kind === parameter.dataType.kind;
				if (value?.inputSource === 'node' && value.nodeId != null) {
					const source = visualModule.nodes.find(source => source.id === value.nodeId);
					compatible ||= areNodeDataTypesCompatible(getNodeOutputs(source, visualModule.paramDefs, definitions)[value.outputPort]?.dataType, parameter.dataType);
				}
				return [parameter.id, value != null && compatible ? value : deepClone(parameter.defaultValue)];
			}));
		}
		const compatibleOutput = (nodeId: string | null, port: string | null, inputType: ReturnType<typeof getNodeInputDataType>) => {
			if (nodeId == null || !changedNodes.has(nodeId) || port == null) return true;
			const output = outputs.get(port);
			// 既存の意図的な型不一致は、表示名やコードだけの編集では解除しない。
			return output != null && (previousOutputs.get(port)?.dataType.kind === output.dataType.kind || areNodeDataTypesCompatible(output.dataType, inputType));
		};
		for (const node of visualModule.nodes) {
			if (node.type === 'globalOut') {
				for (const [id, input] of Object.entries(node.inputs)) {
					if (!compatibleOutput(input.nodeId, input.outputPort, visualModule.outputDefs.find(output => output.id === id)?.dataType ?? null)) node.inputs[id] = { nodeId: null, outputPort: null };
				}
			} else if (node.type === 'relay') {
				if (!compatibleOutput(node.input.nodeId, node.input.outputPort, node.dataType)) node.input = { nodeId: null, outputPort: null };
			} else if (node.type === 'effect') {
				const parameterDefinitions = definitions[node.effectId]?.paramDefs;
				if (parameterDefinitions == null) continue;
				for (const { path, def, value } of walkParameters<VisualModuleParameterBinding>(parameterDefinitions, node.params)) {
					if (value.inputSource !== 'node' || compatibleOutput(value.nodeId, value.outputPort, getNodeInputDataType(def))) continue;
					resolveParameter<VisualModuleParameterBinding>(parameterDefinitions, node.params, path).setValue({ ...value, nodeId: null, outputPort: null });
				}
			}
		}
	}
	for (const layer of layers) {
		if (layer.layerType !== 'effect' || layer.effectId !== reference) continue;
		layer.effectParamValues = Object.fromEntries(next.paramDefs.map(parameter => {
			const value = layer.effectParamValues[parameter.id];
			const compatible = previousParameters.get(parameter.id)?.dataType.kind === parameter.dataType.kind
				|| value != null && (value.inputSource === 'lowerLayerOutput' || value.inputSource === 'anotherLayerOutput') && areNodeDataTypesCompatible({ kind: 'color' }, parameter.dataType);
			return [parameter.id, value != null && compatible ? value : getEffectLayerParameterDefault(definitions[reference], parameter.id)];
		}));
	}
	return usages;
}
