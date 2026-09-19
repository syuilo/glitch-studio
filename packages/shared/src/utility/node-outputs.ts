import { effectDefinitions } from '../effect-definitions.ts';
import type { EffectOutputsSchema } from '../effect-definition.ts';
import type { EffectParamDataType, GsNode, VisualModule } from '../types.ts';

export type NodeDataType = EffectOutputsSchema[string]['dataType'];

export function getNodeInputDataType(param: { type: EffectParamDataType | 'struct' | 'array'; dataType?: NodeDataType; canNode?: boolean }): NodeDataType | null {
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

// 無効化してもポートの定義は変えない。globalOutは入力だけを持つ。
export function getNodeOutputs(node: GsNode | undefined, paramDefs: VisualModule['paramDefs'] = []): EffectOutputsSchema {
	if (node == null) return {};
	if (node.type === 'globalIn') {
		const def = paramDefs.find(def => def.id === node.paramId);
		if (def == null || !def.canNode) return {};
		let dataType: NodeDataType;
		switch (def.type) {
			case 'number': case 'angle': case 'range': case 'seed': case 'time': case 'bool':
				dataType = 'scalar'; break;
			case 'vector': case 'xy': case 'wh': case 'range2':
				dataType = 'vector'; break;
			case 'color': case 'image':
				dataType = 'color'; break;
			case 'signal': dataType = 'any'; break;
			default: return {};
		}
		// primaryはノード内の主出力を示し、モジュールのisPrimaryInputとは独立する。
		return { output: { dataType, primary: true } };
	}
	if (node.type === 'globalOut') return {};
	return effectDefinitions[node.effectId].outputs;
}
