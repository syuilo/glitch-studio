import { effectDefinitions } from '../effect-definitions.ts';
import type { EffectOutputsSchema } from '../effect-definition.ts';
import type { EffectParamDataType, GsNode, VisualModule } from '../types.ts';

export type NodeDataType = EffectOutputsSchema[string]['dataType'];

export function getNodeInputDataType(param: { dataType: EffectParamDataType; canNode?: boolean }): NodeDataType | null {
	if (!param.canNode) return null;
	// canNodeは元のパラメータ型に応じたデータテクスチャを受け取る。
	switch (param.dataType) {
		case 'number': return 'scalar';
		case 'any': return 'any';
		case 'vector': return 'vector';
		case 'color': return 'color';
		default: return null;
	}
}

export function areNodeDataTypesCompatible(output: NodeDataType | undefined, input: NodeDataType | null): boolean {
	if (output == null || input == null) return false;
	return output === input || output === 'any' || input === 'any';
}

// 無効化してもポートの定義は変えない。globalOutは入力だけを持つ。
export function getNodeOutputs(node: GsNode | undefined, paramDefs: VisualModule['paramDefs'] = []): EffectOutputsSchema {
	if (node == null) return {};
	if (node.type === 'globalIn') {
		// 表示名や配列順を変更しても配線を維持するため、パラメータIDをポートIDにする。
		const outputs: EffectOutputsSchema = {};
		for (const def of paramDefs) {
			if (!def.canNode) continue;
			let dataType: NodeDataType;
			switch (def.dataType) {
				case 'number': case 'bool':
					dataType = 'scalar'; break;
				case 'vector':
					dataType = 'vector'; break;
				case 'color': case 'assetReference':
					dataType = 'color'; break;
				default: continue;
			}
			outputs[def.id] = { dataType, primary: def.isPrimaryInput };
		}
		return outputs;
	}
	if (node.type === 'globalOut') return {};
	return effectDefinitions[node.effectId].outputs;
}
