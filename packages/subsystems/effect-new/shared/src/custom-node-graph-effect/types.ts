import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectDefinition, EffectParameterDefinition } from '../effect-definition.ts';
import type { EffectSource } from '../effect-source.ts';

export type CustomNodeGraphEffectConnection =
	| { inputSource: 'publicParameter'; parameterId: string }
	| { inputSource: 'node'; nodeId: string; outputPort: string };

// 公開入力・出力の境界は定数やテクスチャをそのまま渡す。サンプリング設定は実際に読み取る接続が所有する。
export type CustomNodeGraphEffectParameterBinding =
	| EffectParameterDefinition['defaultValue']
	| (CustomNodeGraphEffectConnection & { sampling?: ShaderInputSampling });

export type CustomNodeGraphEffectNode = {
	id: string;
	effectSource: EffectSource;
	params: Record<string, CustomNodeGraphEffectParameterBinding>;
	staticSettings?: StaticSettingValues;
	/** 省略時は親から与えられた描画領域を使う。出力の固有寸法は各出力の接続元が決める。 */
	resolution?: Resolution;
};

export type CustomNodeGraphEffect = EffectDefinition & {
	nodes: CustomNodeGraphEffectNode[];
	/** 公開出力IDから内部の接続元へ対応付ける。未配線の出力はキーを省略する。 */
	outputs: Record<string, CustomNodeGraphEffectConnection>;
};
