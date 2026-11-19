import { inspectStaticParameter, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import { resolveEffectSource } from './effect-source.ts';
import type { EffectDefinitions, EffectSource } from './effect-source.ts';
import type { EffectDefinition } from './effect-definition.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectParameterBinding, NodeOutputReference } from './custom-node-graph-effect.ts';

/** 編集・読み込み時に使う。未使用ポートやバイパスを含む保存グラフを検証し、描画側は再検査しない。 */
export function validateEffectSource(source: EffectSource, definitions: EffectDefinitions): void {
	const validated = new Set<object>();
	const ancestors = new Set<CustomNodeGraphEffect>();
	const ancestorIds = new Set<string>();

	function visit(source: EffectSource): EffectDefinition {
		const effect = resolveEffectSource(source, definitions);
		if (effect.type === 'nativeEffect' || validated.has(effect.definition)) return effect.definition;
		for (const parameter of Object.values(effect.definition.paramDefs)) validateParameterDefaultValues(parameter, true);
		if (effect.type === 'customNodeGraphEffect') {
			const graph = effect.definition;
			const registeredId = source.type === 'customNodeGraphEffectReference' ? source.id : null;
			if (ancestors.has(graph) || (registeredId != null && ancestorIds.has(registeredId))) throw new Error('Cyclic Custom Node Graph Effect reference');
			if (registeredId != null) ancestorIds.add(registeredId);
			ancestors.add(graph);
			const nodes = new Map(graph.nodes.map(node => [node.id, node]));
			if (nodes.size !== graph.nodes.length) throw new Error('Duplicate Custom Node Graph Effect node ID');
			const nodeDefinitions = new Map(graph.nodes.map(node => [node.id, visit(node.effectSource)]));
			const complete = new Set<string>();
			const path = new Set<string>();

			function checkOutput(reference: NodeOutputReference): TextureDataType {
				const output = nodeDefinitions.get(reference.nodeId)?.outputDefs[reference.outputPort];
				if (output == null) throw new Error('Unknown node output: ' + reference.nodeId + '.' + reference.outputPort);
				checkNode(reference.nodeId);
				return output.dataType;
			}

			function checkNode(id: string): void {
				if (complete.has(id)) return;
				if (path.has(id)) throw new Error('Cyclic node connection: ' + [...path, id].join(' → '));
				path.add(id);
				const node = nodes.get(id)!;
				for (const [key, binding] of Object.entries(node.params)) {
					const parameter = nodeDefinitions.get(id)!.paramDefs[key];
					if (parameter == null) throw new Error('Unknown node parameter: ' + id + '.' + key);
					inspectStaticParameter<CustomNodeGraphEffectParameterBinding>(parameter, binding, (def, leaf) => {
						if (leaf.inputSource === 'node' && leaf.source != null) {
							if (!areNodeDataTypesCompatible(checkOutput(leaf.source), getNodeInputDataType(def))) throw new Error('Incompatible node connection: ' + key);
						}
						if (leaf.inputSource === 'customNodeGraphEffectPublicParameterReference') {
							const parameter = graph.paramDefs[leaf.parameterId];
							if (parameter == null) throw new Error('Unknown public parameter: ' + leaf.parameterId);
							const compatible = parameter.canNode === true
								? areNodeDataTypesCompatible(getNodeInputDataType(parameter), getNodeInputDataType(def))
								: areDataTypesEqual(parameter.dataType, def.dataType);
							if (!compatible) throw new Error('Incompatible public parameter: ' + key);
						}
					});
				}
				path.delete(id);
				complete.add(id);
			}

			for (const id of nodes.keys()) checkNode(id);
			for (const [id, output] of Object.entries(graph.outputSources)) {
				if (output == null) continue;
				const parameter = 'parameterId' in output ? graph.paramDefs[output.parameterId] : null;
				const type = 'nodeId' in output ? checkOutput(output) : parameter == null ? null : getNodeInputDataType(parameter);
				if (!areNodeDataTypesCompatible(type, graph.outputDefs[id]?.dataType ?? null)) throw new Error('Incompatible public output: ' + id);
			}
			ancestors.delete(graph);
			if (registeredId != null) ancestorIds.delete(registeredId);
		}
		validated.add(effect.definition);
		return effect.definition;
	}

	visit(source);
}
