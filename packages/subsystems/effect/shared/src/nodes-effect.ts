import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { SharedFunctionCurve } from '@gs/shared/function-curve/function-curve.ts';
import type { DataType, TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectResolution } from './resolution.ts';
import type { EffectDefinition } from './effect-definition.ts';
import type { EffectSource } from './effect-source.ts';

export type NodeOutputReference = { nodeId: string; outputPort: string };
/** 共通の値Bindingに、Nodes Effect内部で解決する参照を加える。 */
export type NodesEffectValueBinding = ValueParameterBinding
	| { inputSource: 'nodesEffectCustomParameterValueReference'; parameterId: string }
	| { inputSource: 'nodesEffectPublicParameterReference'; parameterId: string; sampling?: ShaderInputSampling };

export type NodesEffectParameterBinding = NodesEffectValueBinding
	| { inputSource: 'node'; source: NodeOutputReference | null; sampling: ShaderInputSampling };

// 編集画面で参照方式を選んでから参照先を指定するまで、配置にはパラメータの既定値を渡す。
export function isUnselectedNodesEffectParameterReference(binding: NodesEffectParameterBinding): boolean {
	return (binding.inputSource === 'nodesEffectPublicParameterReference' || binding.inputSource === 'nodesEffectCustomParameterValueReference') && binding.parameterId === '';
}

export interface NodesEffectEffectNode {
	readonly id: string;
	readonly type?: 'effect';
	readonly effectSource: EffectSource;
	readonly params: Readonly<Record<string, NodesEffectParameterBinding>>;
	readonly staticSettings?: StaticSettingValues;
	/** 指定時はこの配置の基準寸法。省略時は解像度入力または親の基準寸法を使う。 */
	readonly resolution?: Resolution | EffectResolution;
	readonly isBypass?: boolean;
}

export type NodesEffectNode = NodesEffectEffectNode | {
	// dataTypeは接続時の互換性判定に使う宣言型。描画時には入力をそのまま中継する。
	readonly type: 'relay'; readonly id: string; readonly dataType: TextureDataType; readonly input: NodesEffectOutputSource | null;
};

export type NodesEffectOutputSource = NodeOutputReference | { parameterId: string };

type CustomParameterType = Extract<DataType, { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' | 'sizeReference' }>;

export interface NodesEffect extends EffectDefinition {
	readonly outputDefs: Readonly<Record<string, EffectDefinition['outputDefs'][string] & { readonly nameForReference?: string }>>;
	readonly paramDefs: Readonly<Record<string, ParameterDefinition & { readonly nameForReference?: string }>>;
	/** グラフ内の複数のノードで共有するCPU値の定義。Nodes Effectの公開入力とは独立する。 */
	readonly customParameterDefs?: Readonly<Record<string, ParameterDefinition<CustomParameterType> & { readonly nameForReference: string; readonly canNode?: false }>>;
	readonly customParameterValues?: Readonly<Record<string, NodesEffectValueBinding>>;
	readonly functionCurves?: readonly SharedFunctionCurve[];
	readonly nodes: readonly NodesEffectNode[];
	/** outputDefsのポートIDをキーにする。公開入力からの直結はテクスチャのある配置で出力する。未接続の公開出力にはエントリを持たない。 */
	readonly outputSources: Readonly<Partial<Record<string, NodesEffectOutputSource>>>;
}
