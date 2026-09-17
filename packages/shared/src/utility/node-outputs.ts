import { effectDefinitions } from '../effect-definitions.ts';
import type { EffectOutputsSchema } from '../effect-definition.ts';
import type { EffectParamDataType, GsNode } from '../types.ts';

export type NodeDataType = EffectOutputsSchema[string]['dataType'];

export function getNodeInputDataType(param: { type: EffectParamDataType; dataType?: NodeDataType; canNode?: boolean }): NodeDataType | null {
	if (!param.canNode) return null;
	// canNodeは元のパラメータ型に応じたデータテクスチャを受け取る。
	switch (param.type) {
		case 'number':
		case 'angle':
		case 'range': return 'scalar';
		case 'vector': return 'vector';
		case 'color': return 'color';
		default: return null;
	}
}

export function areNodeDataTypesCompatible(output: NodeDataType | undefined, input: NodeDataType | null): boolean {
	if (output == null || input == null) return false;
	return output === input || output === 'any' || input === 'any';
}

// グループは末尾の子ノードの出力ポートを公開する。無効化してもポートの定義は変えない。
export function getNodeOutputs(node: GsNode | undefined): EffectOutputsSchema {
	if (node == null) return {};
	return node.type === 'group' ? getNodeOutputs(node.nodes.at(-1)) : effectDefinitions[node.effectId].outputs;
}
