import { isTextureDataType } from '../data-type.ts';
import { effectDefinitions } from '../effect/effect-definitions.ts';
import type { DataType, TextureDataType } from '../data-type.ts';
import type { EffectOutputDefinitions } from '../effect/effect-definition.ts';
import type { VisualModuleNode, VisualModule } from '../visual-module/types.ts';

export function getNodeInputDataType(param: { dataType: DataType; canNode?: boolean }): TextureDataType | null {
	return param.canNode && isTextureDataType(param.dataType) ? param.dataType : null;
}

export function areNodeDataTypesCompatible(output: TextureDataType | undefined, input: TextureDataType | null): boolean {
	if (output == null || input == null) return false;
	return output === input || output === 'any' || input === 'any';
}

// 無効化してもポートの定義は変えない。globalOutは入力だけを持つ。
export function getNodeOutputs(node: VisualModuleNode | undefined, paramDefs: VisualModule['paramDefs'] = []): EffectOutputDefinitions {
	if (node == null) return {};
	if (node.type === 'globalIn') {
		// 表示名や配列順を変更しても配線を維持するため、パラメータIDをポートIDにする。
		const outputs: EffectOutputDefinitions = {};
		for (const def of paramDefs) {
			if (!def.canNode) continue;
			outputs[def.id] = { dataType: def.dataType, primary: def.isPrimaryInput };
		}
		return outputs;
	}
	if (node.type === 'globalOut') return {};
	return effectDefinitions[node.effectId].outputDefs;
}
