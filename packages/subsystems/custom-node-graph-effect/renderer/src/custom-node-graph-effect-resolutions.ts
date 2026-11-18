import { resolveEffectNodeResolution } from '@gs/subsystems_effect_shared/effect-node-resolution.ts';
import { getEffectInputResolution } from '@gs/subsystems_effect_shared/effect-resolution-inputs.ts';
import { resolveCustomNodeGraphEffectOutputSource } from './custom-node-graph-effect-output-source.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode, CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';

/** 設定スナップショットに対する計画。描画結果・時刻・GPUリソースを入力に含めない。 */
export function resolveCustomNodeGraphEffectResolutions(options: {
	customNodeGraphEffect: Pick<CustomNodeGraphEffect, 'nodes' | 'paramDefs' | 'outputDefs' | 'primaryInputId' | 'primaryOutputId'>;
	effectDefinitions: Readonly<Record<string, EffectDefinition>>;
	contextResolution: Resolution;
	resolutionScale: number;
	maxDimension: number;
	inputResolutions: ReadonlyMap<string, Resolution | null>;
	getIntrinsicResolution: (node: CustomNodeGraphEffectEffectNode) => Resolution | null;
}): Map<string, Resolution> {
	const nodes = new Map(options.customNodeGraphEffect.nodes.map(node => [node.id, node]));
	const outputContext = { ...options.customNodeGraphEffect, nodes, effectDefinitions: options.effectDefinitions };
	const resolutions = new Map<string, Resolution>();
	const connectionResolution = (nodeId: string | null, port: string | null): Resolution | null => {
		const node = nodeId == null ? null : nodes.get(nodeId);
		if (node == null) return null;
		const output = resolveCustomNodeGraphEffectOutputSource(outputContext, node, port);
		if (output == null) return null;
		return output.node.type === 'globalIn' ? options.inputResolutions.get(output.outputPort) ?? null : nodeResolution(output.node);
	};
	const nodeResolution = (node: CustomNodeGraphEffectEffectNode): Resolution => {
		const cached = resolutions.get(node.id);
		if (cached != null) return cached;
		const definition = options.effectDefinitions[node.effectId];
		const resolution = resolveEffectNodeResolution({
			setting: node.resolution,
			contextResolution: options.contextResolution,
			resolutionScale: options.resolutionScale,
			intrinsicResolution: node.resolution.mode === 'auto' ? options.getIntrinsicResolution(node) : null,
			inputResolution: node.resolution.mode === 'auto' ? getEffectInputResolution<CustomNodeGraphEffectParameterBinding>(definition, node.params, binding =>
				binding.inputSource === 'node' ? connectionResolution(binding.nodeId, binding.outputPort)
					: binding.inputSource === 'customNodeGraphEffectPublicParameterReference' ? options.inputResolutions.get(binding.parameterId) ?? null : null) : null,
			maxDimension: options.maxDimension,
		});
		resolutions.set(node.id, resolution);
		return resolution;
	};
	for (const node of options.customNodeGraphEffect.nodes) if (node.type === 'effect') nodeResolution(node);
	return resolutions;
}
