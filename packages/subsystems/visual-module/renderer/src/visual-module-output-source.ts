import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule, VisualModuleEffectNode, VisualModuleGlobalInNode, VisualModuleNode } from '@gs/subsystems_visual-module_shared/types.ts';

type VisualModuleOutputContext = Pick<VisualModule, 'paramDefs' | 'outputDefs' | 'primaryInputId' | 'primaryOutputId'> & {
	nodes: ReadonlyMap<string, VisualModuleNode>;
	effectDefinitions: Readonly<Record<string, EffectDefinition>>;
};

/** 描画・キャッシュ・解像度計画が、保存済みの配線を同じ規則でたどる。GPUや評価値は扱わない。 */
export function resolveVisualModuleOutputSource(context: VisualModuleOutputContext, node: VisualModuleNode,
	outputPort?: string | null): { node: VisualModuleEffectNode | VisualModuleGlobalInNode; outputPort: string } | null {
	if (node.type === 'relay') {
		if (outputPort != null && outputPort !== 'output') return null;
		const input = node.input;
		const source = input.nodeId == null ? null : context.nodes.get(input.nodeId);
		if (source == null || input.outputPort == null) return null;
		// 宣言型の異なる接続も通すが、存在しないポートを主出力へ読み替えない。
		const outputs = source.type === 'effect' ? context.effectDefinitions[source.effectId].outputDefs : getNodeOutputs(source, context.paramDefs);
		if (outputs[input.outputPort] == null) return null;
		return resolveVisualModuleOutputSource(context, source, input.outputPort);
	}
	if (node.type === 'globalIn') {
		const port = outputPort ?? context.primaryInputId;
		return port != null && getNodeOutputs(node, context.paramDefs)[port] != null ? { node, outputPort: port } : null;
	}
	if (node.type === 'globalOut') {
		const port = outputPort ?? context.primaryOutputId;
		if (port == null || !context.outputDefs.some(definition => definition.id === port)) return null;
		const input = node.inputs[port];
		const source = input?.nodeId == null ? null : context.nodes.get(input.nodeId);
		return source == null ? null : resolveVisualModuleOutputSource(context, source, input.outputPort);
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
	return source == null ? null : resolveVisualModuleOutputSource(context, source, input.outputPort);
}
