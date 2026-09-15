import { effectDefinitions } from '../effect-definitions.ts';
import type { EffectOutputsSchema } from '../effect-definition.ts';
import type { GsNode } from '../types.ts';

// グループは末尾の子ノードの出力ポートを公開する。無効化してもポートの定義は変えない。
export function getNodeOutputs(node: GsNode | undefined): EffectOutputsSchema {
	if (node == null) return {};
	return node.type === 'group' ? getNodeOutputs(node.nodes.at(-1)) : effectDefinitions[node.effectId].outputs;
}
