import type { ValueParameterBinding } from './value-parameter-binding.ts';

// 共通のツリー操作が必要とする識別子だけを定義する。
// 利用可能な入力方式と固有のフィールドは各ドメインが所有し、ここへ集約しない。
export type ParameterBindingBase = { inputSource: string };

// 各ドメインはliteralの保存形式を共有し、固有の入力方式には別の識別子を使う。
export function isLiteralParameterBinding(binding: ParameterBindingBase): binding is Extract<ValueParameterBinding, { inputSource: 'literal' }> {
	return binding.inputSource === 'literal';
}

// 入力方式の判定。保存データのフィールド全体を検証するものではない。
export function isValueParameterBinding(binding: ParameterBindingBase): binding is ValueParameterBinding {
	return binding.inputSource === 'literal' || binding.inputSource === 'envVariable' || binding.inputSource === 'expression'
		|| binding.inputSource === 'automationGraphReference' || binding.inputSource === 'automationGraphInline' || binding.inputSource === 'keyframesTimelineInline';
}

// IDは同じ配列内で一意。値やBindingの種類が変わっても編集対象を追跡できるよう、
// Bindingの外側に保持する。評価後の配列やDataType自体にはこのIDを含めない。
export type ParameterArrayElement<Binding extends ParameterBindingBase = ValueParameterBinding> = {
	id: string;
	binding: Binding;
};
