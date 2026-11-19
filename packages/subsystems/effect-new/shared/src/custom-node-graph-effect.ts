import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectDefinition } from './effect-definition.ts';
import type { EffectSource } from './effect-source.ts';

export type NodeOutputReference = { nodeId: string; outputPort: string };
export type CustomNodeGraphEffectParameterBinding = ValueParameterBinding
	| { inputSource: 'node'; source: NodeOutputReference | null; sampling: ShaderInputSampling }
	| { inputSource: 'customNodeGraphEffectPublicParameterReference'; parameterId: string; sampling?: ShaderInputSampling };

export interface CustomNodeGraphEffectNode {
	readonly id: string;
	readonly effectSource: EffectSource;
	readonly params: Readonly<Record<string, CustomNodeGraphEffectParameterBinding>>;
	readonly staticSettings?: StaticSettingValues;
	/** 指定時はこの配置の基準寸法。省略時は解像度入力または親の基準寸法を使う。 */
	readonly resolution?: Resolution;
	readonly isBypass?: boolean;
}

export type CustomNodeGraphEffectOutputSource = NodeOutputReference | { parameterId: string };

export interface CustomNodeGraphEffect extends EffectDefinition {
	readonly nodes: readonly CustomNodeGraphEffectNode[];
	/** 公開入力からの直結は値・解像度を借用する。未接続の公開出力にはエントリを持たない。 */
	readonly outputSources: Readonly<Partial<Record<string, CustomNodeGraphEffectOutputSource>>>;
}
