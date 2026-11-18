import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectDefinition } from '../effect-definition.ts';
import type { EffectSource } from '../effect-source.ts';

export type CustomNodeGraphEffectConnection =
	| { inputSource: 'node'; nodeId: string; outputPort: string }
	| { inputSource: 'customNodeGraphEffectPublicParameterReference'; parameterId: string };

export type CustomNodeGraphEffectParameterBinding =
	| ValueParameterBinding
	| (CustomNodeGraphEffectConnection & Partial<ShaderInputSampling>);

export type CustomNodeGraphEffectNode = {
	id: string;
	effectSource: EffectSource;
	params: Record<string, CustomNodeGraphEffectParameterBinding>;
	staticSettings?: StaticSettingValues;
	/** 未指定の場合は、この配置の自動解像度を使う。 */
	resolution?: Resolution;
};

export type CustomNodeGraphEffect = EffectDefinition & {
	nodes: CustomNodeGraphEffectNode[];
	// 公開出力の固定IDから、その値を供給するポートへ対応付ける。未接続の出力はキーを省略する。
	// 直接渡す値も内部計算で得た値も、読み取り時のsamplingは受け取り側の接続が決める。
	outputs: Record<string, CustomNodeGraphEffectConnection>;
};
