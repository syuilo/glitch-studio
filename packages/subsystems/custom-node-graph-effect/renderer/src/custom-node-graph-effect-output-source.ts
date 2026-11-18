import { getNodeOutputs } from '@gs/subsystems_custom-node-graph-effect_shared/node-outputs.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode, CustomNodeGraphEffectGlobalInNode, CustomNodeGraphEffectNode } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';

type CustomNodeGraphEffectOutputContext = Pick<CustomNodeGraphEffect, 'paramDefs' | 'outputDefs' | 'primaryInputId' | 'primaryOutputId'> & {
	nodes: ReadonlyMap<string, CustomNodeGraphEffectNode>;
	effectDefinitions: Readonly<Record<string, EffectDefinition>>;
};

/** 描画・キャッシュ・解像度計画が、保存済みの配線を同じ規則でたどる。GPUや評価値は扱わない。 */
export function resolveCustomNodeGraphEffectOutputSource(context: CustomNodeGraphEffectOutputContext, node: CustomNodeGraphEffectNode,
	outputPort?: string | null): { node: CustomNodeGraphEffectEffectNode | CustomNodeGraphEffectGlobalInNode; outputPort: string } | null {
	if (node.type === 'relay') {
		if (outputPort != null && outputPort !== 'output') return null;
		const input = node.input;
		const source = input.nodeId == null ? null : context.nodes.get(input.nodeId);
		if (source == null || input.outputPort == null) return null;
		// 宣言型の異なる接続も通すが、存在しないポートを主出力へ読み替えない。
		const outputs = source.type === 'effect' ? context.effectDefinitions[source.effectId].outputDefs : getNodeOutputs(source, context.paramDefs, context.effectDefinitions);
		if (outputs[input.outputPort] == null) return null;
		return resolveCustomNodeGraphEffectOutputSource(context, source, input.outputPort);
	}
	if (node.type === 'globalIn') {
		const port = outputPort ?? context.primaryInputId;
		return port != null && getNodeOutputs(node, context.paramDefs, context.effectDefinitions)[port] != null ? { node, outputPort: port } : null;
	}
	if (node.type === 'globalOut') {
		const port = outputPort ?? context.primaryOutputId;
		if (port == null || !context.outputDefs.some(definition => definition.id === port)) return null;
		const input = node.inputs[port];
		const source = input?.nodeId == null ? null : context.nodes.get(input.nodeId);
		return source == null ? null : resolveCustomNodeGraphEffectOutputSource(context, source, input.outputPort);
	}
	if (!node.isBypass) {
		const definition = context.effectDefinitions[node.effectId];
		const port = outputPort ?? definition.primaryOutput;
		return port == null || definition.outputDefs[port] == null ? null : { node, outputPort: port };
	}
	const primary = context.effectDefinitions[node.effectId].primaryInputParameter;
	// 式の結果から接続を作らず、静的検証したBindingだけをたどる。
	const input = primary == null ? null : node.params[primary];
	if (input?.inputSource !== 'node' || input.nodeId == null) return null;
	// バイパスは自身の出力名に関係なく、主入力が選択したポートをそのまま公開する。
	const source = context.nodes.get(input.nodeId);
	return source == null ? null : resolveCustomNodeGraphEffectOutputSource(context, source, input.outputPort);
}
