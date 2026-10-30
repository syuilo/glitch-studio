import { resolveEffectNodeResolution } from '@gs/subsystems_effect_shared/effect-node-resolution.ts';
import { getEffectInputResolution } from '@gs/subsystems_effect_shared/effect-resolution-inputs.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { VisualModule, VisualModuleEffectNode, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';

/** 設定スナップショットに対する計画。描画結果・時刻・GPUリソースを入力に含めない。 */
export function resolveVisualModuleResolutions(options: {
	visualModule: Pick<VisualModule, 'nodes' | 'primaryInputId' | 'primaryOutputId'>;
	effectDefinitions: Readonly<Record<string, EffectDefinition>>;
	contextResolution: Resolution;
	resolutionScale: number;
	maxDimension: number;
	inputResolutions: ReadonlyMap<string, Resolution | null>;
	getIntrinsicResolution: (node: VisualModuleEffectNode) => Resolution | null;
}): Map<string, Resolution> {
	const nodes = new Map(options.visualModule.nodes.map(node => [node.id, node]));
	const resolutions = new Map<string, Resolution>();
	const connectionResolution = (nodeId: string | null, port: string | null): Resolution | null => {
		const node = nodeId == null ? null : nodes.get(nodeId);
		if (node == null) return null;
		if (node.type === 'globalIn') return options.inputResolutions.get(port ?? options.visualModule.primaryInputId ?? '') ?? null;
		if (node.type === 'globalOut') {
			const input = node.inputs[port ?? options.visualModule.primaryOutputId ?? ''];
			return input == null ? null : connectionResolution(input.nodeId, input.outputPort);
		}
		if (node.type === 'relay') return connectionResolution(node.input.nodeId, node.input.outputPort);
		if (node.isBypass) {
			const primary = options.effectDefinitions[node.effectId].primaryInputParameter;
			const input = primary == null ? null : node.params[primary];
			return input?.inputSource === 'node' ? connectionResolution(input.nodeId, input.outputPort) : null;
		}
		return nodeResolution(node);
	};
	const nodeResolution = (node: VisualModuleEffectNode): Resolution => {
		const cached = resolutions.get(node.id);
		if (cached != null) return cached;
		const definition = options.effectDefinitions[node.effectId];
		const resolution = resolveEffectNodeResolution({
			setting: node.resolution,
			contextResolution: options.contextResolution,
			resolutionScale: options.resolutionScale,
			intrinsicResolution: node.resolution.mode === 'auto' ? options.getIntrinsicResolution(node) : null,
			inputResolution: node.resolution.mode === 'auto' ? getEffectInputResolution<VisualModuleParameterBinding>(definition, node.params, binding =>
				binding.inputSource === 'node' ? connectionResolution(binding.nodeId, binding.outputPort)
					: binding.inputSource === 'visualModuleCustomParameterReference' ? options.inputResolutions.get(binding.parameterId) ?? null : null) : null,
			maxDimension: options.maxDimension,
		});
		resolutions.set(node.id, resolution);
		return resolution;
	};
	for (const node of options.visualModule.nodes) if (node.type === 'effect') nodeResolution(node);
	return resolutions;
}
