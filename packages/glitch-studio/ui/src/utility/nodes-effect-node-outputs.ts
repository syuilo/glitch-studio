import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { getEffectDefinitions } from './project-effects.ts';
type EffectOutputDefinitions = Record<string, EffectDefinition['outputDefs'][string]>;
import type { NodesEffectNode, NodesEffect } from '../types/nodes-effect-view.ts';

// 無効化してもポートの定義は変えない。globalOutは入力だけを持つ。
// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function getNodeOutputs(node: NodesEffectNode | null | undefined, paramDefs: NodesEffect['paramDefs'] = [], definitions: ReturnType<typeof getEffectDefinitions>): EffectOutputDefinitions {
	if (node == null) return {};
	if (node.type === 'globalIn') {
		// 表示名や配列順を変更しても配線を維持するため、パラメータIDをポートIDにする。
		const outputs: EffectOutputDefinitions = {};
		for (const def of paramDefs) {
			if (!def.canNode || !isTextureDataType(def.dataType)) continue;
			outputs[def.id] = { dataType: def.dataType };
		}
		return outputs;
	}
	if (node.type === 'globalOut') return {};
	if (node.type === 'relay') return { output: { dataType: node.dataType } };
	return definitions.describe(node.effectSource).outputDefs;
}
