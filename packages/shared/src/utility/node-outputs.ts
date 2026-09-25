import { isTextureDataType } from '../data-type.ts';
import { effectDefinitions } from '../effect/effect-definitions.ts';
import type { DataType, TextureDataType } from '../data-type.ts';
import type { EffectOutputDefinitions } from '../effect/effect-definition.ts';
import type { GsNode, VisualModule } from '../visual-module/types.ts';

export function getNodeInputDataType(param: { dataType: DataType; canNode?: boolean }): TextureDataType | null {
	return param.canNode && isTextureDataType(param.dataType) ? param.dataType : null;
}

export function areNodeDataTypesCompatible(output: TextureDataType | undefined, input: TextureDataType | null): boolean {
	if (output == null || input == null) return false;
	return output === input || output === 'any' || input === 'any';
}

// 無効化してもポートの定義は変えない。globalOutは入力だけを持つ。
export function getNodeOutputs(node: GsNode | undefined, paramDefs: VisualModule['paramDefs'] = []): EffectOutputDefinitions {
	if (node == null) return {};
	if (node.type === 'globalIn') {
		// 表示名や配列順を変更しても配線を維持するため、パラメータIDをポートIDにする。
		const outputs: EffectOutputDefinitions = {};
		for (const def of paramDefs) {
			if (!def.canNode) continue;
			// 真偽値は数値化し、Asset参照は画像として出力する。それ以外は元の型を使う。
			const dataType = def.dataType === 'bool' ? 'scalar' : def.dataType === 'assetReference' ? 'color' : def.dataType;
			if (!isTextureDataType(dataType)) continue;
			outputs[def.id] = { dataType, primary: def.isPrimaryInput };
		}
		return outputs;
	}
	if (node.type === 'globalOut') return {};
	return effectDefinitions[node.effectId].outputDefs;
}
