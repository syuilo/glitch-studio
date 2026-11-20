import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { DataType, TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectResolution } from './resolution.ts';
import type { EffectDefinition, EffectParameterDefinition } from './effect-definition.ts';
import type { EffectSource } from './effect-source.ts';

export type NodeOutputReference = { nodeId: string; outputPort: string };
export type CustomNodeGraphEffectValueBinding = ValueParameterBinding
	| { inputSource: 'customNodeGraphEffectCustomParameterValueReference'; parameterId: string }
	| { inputSource: 'customNodeGraphEffectPublicParameterReference'; parameterId: string; sampling?: ShaderInputSampling };

export type CustomNodeGraphEffectParameterBinding = CustomNodeGraphEffectValueBinding
	| { inputSource: 'node'; source: NodeOutputReference | null; sampling: ShaderInputSampling };

// 編集画面で参照方式を選んでから参照先を指定するまで、配置にはパラメータの既定値を渡す。
export function isUnselectedGraphParameterReference(binding: CustomNodeGraphEffectParameterBinding): boolean {
	return (binding.inputSource === 'customNodeGraphEffectPublicParameterReference' || binding.inputSource === 'customNodeGraphEffectCustomParameterValueReference') && binding.parameterId === '';
}

export interface CustomNodeGraphEffectEffectNode {
	readonly id: string;
	readonly type?: 'effect';
	readonly effectSource: EffectSource;
	readonly params: Readonly<Record<string, CustomNodeGraphEffectParameterBinding>>;
	readonly staticSettings?: StaticSettingValues;
	/** 指定時はこの配置の基準寸法。省略時は解像度入力または親の基準寸法を使う。 */
	readonly resolution?: Resolution | EffectResolution;
	readonly isBypass?: boolean;
}

export type CustomNodeGraphEffectNode = CustomNodeGraphEffectEffectNode | {
	readonly type: 'relay'; readonly id: string; readonly dataType: TextureDataType; readonly input: CustomNodeGraphEffectOutputSource | null;
};

export type CustomNodeGraphEffectOutputSource = NodeOutputReference | { parameterId: string };

type CustomParameterType = Extract<DataType, { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' | 'sizeReference' }>;

export interface CustomNodeGraphEffect extends EffectDefinition {
	readonly outputDefs: Readonly<Record<string, EffectDefinition['outputDefs'][string] & { readonly nameForReference?: string }>>;
	readonly paramDefs: Readonly<Record<string, EffectParameterDefinition & { readonly nameForReference?: string }>>;
	readonly customParameterDefs?: Readonly<Record<string, EffectParameterDefinition<CustomParameterType> & { readonly nameForReference: string; readonly canNode?: false }>>;
	readonly customParameterValues?: Readonly<Record<string, CustomNodeGraphEffectValueBinding>>;
	readonly automationGraphs?: readonly AutomationGraph[];
	readonly nodes: readonly CustomNodeGraphEffectNode[];
	/** 公開入力からの直結はテクスチャのある配置で出力する。未接続の公開出力にはエントリを持たない。 */
	readonly outputSources: Readonly<Partial<Record<string, CustomNodeGraphEffectOutputSource>>>;
}
