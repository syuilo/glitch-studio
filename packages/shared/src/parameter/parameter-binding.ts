import type { FitMode, WrapMode } from '../types.ts';
import type { ValueParameterBinding } from './value-parameter-binding.ts';

// NOTE: externalCustomParameterInput、node、layerInputについては本来的にはこの汎用ParameterBinding型ではなく、各利用ドメイン側で拡張するべきであるが、そこまで厳密に分けると実装が複雑化するため、便宜上ここに含めている
// 評価器の対応範囲とは別
export type ParameterBinding = ValueParameterBinding | {
	inputSource: 'layerInput';
	fitMode: FitMode;
	wrapMode: WrapMode;
	filterMode: 'linear' | 'nearest';
} | {
	inputSource: 'externalCustomParameterInput';
	parameterId: VisualModuleCustomParameterId;
} | ({ inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null }));

export function isValueParameterBinding(binding: ParameterBinding): binding is ValueParameterBinding {
	return binding.inputSource === 'literal' || binding.inputSource === 'envVariable' || binding.inputSource === 'expression'
		|| binding.inputSource === 'automationGraphReference' || binding.inputSource === 'automationGraphInline' || binding.inputSource === 'keyframesTimelineInline';
}

// IDは同じ配列内で一意。値やBindingの種類が変わっても編集対象を追跡できるよう、
// Bindingの外側に保持する。評価後の配列やDataType自体にはこのIDを含めない。
export type ParameterArrayElement<Binding extends ParameterBinding = ParameterBinding> = {
	id: string;
	binding: Binding;
};
