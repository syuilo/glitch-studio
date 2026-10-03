import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import type { EffectOutputDefinitions } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModuleNode, VisualModule } from './types.ts';

// 無効化してもポートの定義は変えない。globalOutは入力だけを持つ。
export function getNodeOutputs(node: VisualModuleNode | undefined, paramDefs: VisualModule['paramDefs'] = []): EffectOutputDefinitions {
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
	return effectDefinitions[node.effectId].outputDefs;
}
