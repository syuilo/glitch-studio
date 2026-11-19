import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectSource } from '../effect-source.ts';
import type { EffectResolution } from '../resolution.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { FitMode, WrapMode } from '@gs/shared/types.ts';

/** リレーや公開出力は値を転送するだけなので、サンプリング設定を所有しない。 */
export type CustomNodeGraphEffectOutputConnection = { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };

export type CustomNodeGraphEffectNodeParameterBinding = { inputSource: 'node' } & (
	| { nodeId: string; outputPort: string; fitMode: FitMode; wrapMode: WrapMode; filterMode: 'linear' | 'nearest' }
	| { nodeId: null; outputPort: null }
);

export type CustomNodeGraphEffectPublicParameterReferenceBinding = {
	inputSource: 'customNodeGraphEffectPublicParameterReference';
	parameterId: CustomNodeGraphEffectPublicParameterId;
};

export type CustomNodeGraphEffectCustomParameterReferenceBinding = {
	inputSource: 'customNodeGraphEffectCustomParameterValueReference';
	parameterId: CustomNodeGraphEffectCustomParameterId;
};

// カスタムパラメータはCPU値だけを共有し、ノードの画像配線は所有しない。
export type CustomNodeGraphEffectValueParameterBinding = ValueParameterBinding | CustomNodeGraphEffectPublicParameterReferenceBinding | CustomNodeGraphEffectCustomParameterReferenceBinding;

// Custom Node Graph Effect内部でだけ解決できる参照を、共通の値入力に加える。
export type CustomNodeGraphEffectParameterBinding = CustomNodeGraphEffectValueParameterBinding | CustomNodeGraphEffectNodeParameterBinding;

type CustomNodeGraphEffectNodeBase = {
	id: string;
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectEffectNode = CustomNodeGraphEffectNodeBase & {
	type: 'effect';
	effectSource: EffectSource;
	isBypass: boolean;
	resolution: EffectResolution;
	params: Record<string, CustomNodeGraphEffectParameterBinding>;
	staticSettings: StaticSettingValues;
	displayName: string;
};

export type CustomNodeGraphEffectGlobalInNode = CustomNodeGraphEffectNodeBase & {
	type: 'globalIn';
};

export type CustomNodeGraphEffectGlobalOutNode = CustomNodeGraphEffectNodeBase & {
	type: 'globalOut';
	// キーはCustomNodeGraphEffect.outputDefsのID。未設定のポートは未接続として扱う。
	inputs: Record<string, CustomNodeGraphEffectOutputConnection>;
};

export type CustomNodeGraphEffectRelayNode = CustomNodeGraphEffectNodeBase & {
	type: 'relay';
	label?: string;
	// 入出力の宣言型。接続時の互換性判定に使い、レンダラーでは型の強制や変換を行わない。
	dataType: TextureDataType;
	input: CustomNodeGraphEffectOutputConnection;
};

export type CustomNodeGraphEffectNode = CustomNodeGraphEffectEffectNode | CustomNodeGraphEffectGlobalInNode | CustomNodeGraphEffectGlobalOutNode | CustomNodeGraphEffectRelayNode;

declare const customNodeGraphEffectPublicParameterIdentity: unique symbol;
declare const customNodeGraphEffectCustomParameterIdentity: unique symbol;

export type CustomNodeGraphEffectPublicParameterId = string & { readonly [customNodeGraphEffectPublicParameterIdentity]: 'id' };
export type CustomNodeGraphEffectPublicParameterName = string & { readonly [customNodeGraphEffectPublicParameterIdentity]: 'name' };
export type CustomNodeGraphEffectCustomParameterId = string & { readonly [customNodeGraphEffectCustomParameterIdentity]: 'id' };
export type CustomNodeGraphEffectCustomParameterName = string & { readonly [customNodeGraphEffectCustomParameterIdentity]: 'name' };

// 生成・入力・式との境界でのみ使う。既に分類済みのID/名前を相互変換させない。
// 実在性やスコープ内での可用性を保証する型ではなく、保存形式は通常の文字列のまま。
type UnbrandedString = string & { readonly [customNodeGraphEffectPublicParameterIdentity]?: never; readonly [customNodeGraphEffectCustomParameterIdentity]?: never };
export function customNodeGraphEffectPublicParameterId(value: UnbrandedString): CustomNodeGraphEffectPublicParameterId {
	return value as unknown as CustomNodeGraphEffectPublicParameterId;
}
export function customNodeGraphEffectPublicParameterName(value: UnbrandedString): CustomNodeGraphEffectPublicParameterName {
	return value as unknown as CustomNodeGraphEffectPublicParameterName;
}
export function customNodeGraphEffectCustomParameterId(value: UnbrandedString): CustomNodeGraphEffectCustomParameterId {
	return value as unknown as CustomNodeGraphEffectCustomParameterId;
}
export function customNodeGraphEffectCustomParameterName(value: UnbrandedString): CustomNodeGraphEffectCustomParameterName {
	return value as unknown as CustomNodeGraphEffectCustomParameterName;
}

export type CustomNodeGraphEffectOutputDef = {
	id: string;
	label: string;
	name: string;
	dataType: TextureDataType;
};

export type CustomNodeGraphEffectParamDef = ParameterDefinition & {
	id: CustomNodeGraphEffectPublicParameterId;
	nameForReference: CustomNodeGraphEffectPublicParameterName; // expressionから参照するとき用
	// ParameterDefinitionでノード入力を許可する型だけ、Inノードの出力として公開できる。
	canNode: boolean;
};

export type CustomNodeGraphEffectCustomParameterDefinition = Extract<ParameterDefinition, { dataType: { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' | 'sizeReference' } }> & {
	id: CustomNodeGraphEffectCustomParameterId;
	nameForReference: CustomNodeGraphEffectCustomParameterName;
	canNode: false;
};

export type CustomNodeGraphEffect = {
	/** 主入力の有無と独立して、配置時の既定動作を著者が選ぶ。 */
	kind: 'generate' | 'modify';
	nodes: CustomNodeGraphEffectNode[];
	outputDefs: CustomNodeGraphEffectOutputDef[];
	primaryOutputId: string | null;
	paramDefs: CustomNodeGraphEffectParamDef[];
	/** 内部の共通値。未使用時も空の配列・オブジェクトを持ち、公開引数には含めない。 */
	customParameterDefs: CustomNodeGraphEffectCustomParameterDefinition[];
	customParameterValues: Record<CustomNodeGraphEffectCustomParameterId, CustomNodeGraphEffectValueParameterBinding>;
	primaryInputId: CustomNodeGraphEffectPublicParameterId | null;
	/** 音声の自動割当先。Inノードの画像入力とは独立する。 */
	primaryAudioInputId?: CustomNodeGraphEffectPublicParameterId | null;
	automationGraphs: AutomationGraph[];
};

