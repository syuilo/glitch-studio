import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterChangeKind, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { FitMode, WrapMode } from '@gs/shared/types.js';

export type CustomNodeGraphEffectNodeParameterBinding = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

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

export type CustomNodeGraphEffectEffectNode = {
	id: string;
	type: 'effect';
	effectId: string;
	isBypass: boolean;
	resolution: EffectResolution;
	params: Record<string, CustomNodeGraphEffectParameterBinding>;
	staticSettings: StaticSettingValues;

	displayName: string;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectGlobalInNode = {
	id: string;
	type: 'globalIn';

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectGlobalOutNode = {
	id: string;
	type: 'globalOut';
	// キーはCustomNodeGraphEffect.outputDefsのID。未設定のポートは未接続として扱う。
	inputs: Record<string, { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null }>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectRelayNode = {
	id: string;
	type: 'relay';
	label?: string;
	// 入出力の宣言型。接続時の互換性判定に使い、レンダラーでは型の強制や変換を行わない。
	dataType: TextureDataType;
	input: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectNode = CustomNodeGraphEffectEffectNode | CustomNodeGraphEffectGlobalInNode | CustomNodeGraphEffectGlobalOutNode | CustomNodeGraphEffectRelayNode;

// ノード自身の変更内容だけを表す。所属Moduleや変更後の描画方針は含めない。
export type CustomNodeGraphEffectNodeChange =
	| { type: 'parameter'; kind: ParameterChangeKind }
	| { type: 'bypass' | 'resolution' | 'staticSetting' };

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

// レイヤー・Custom Node Graph Effect Live Previewからは、Custom Node Graph Effect内部のノードやパラメータを参照しない。
export type CustomNodeGraphEffectArgumentBindings = Record<CustomNodeGraphEffectPublicParameterId, ValueParameterBinding>;

export type EffectNodeOf<DEF extends Pick<EffectDefinition, 'id' | 'paramDefs' | 'staticSettingDefs'>> =
	Omit<CustomNodeGraphEffectEffectNode, 'effectId' | 'params' | 'staticSettings'> & {
		effectId: DEF['id'];
		staticSettings: StaticSettingValues<NonNullable<DEF['staticSettingDefs']>>;
		params: {
			[K in keyof DEF['paramDefs']]-?: CustomNodeGraphEffectParameterBinding;
		};
	};

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode: FitMode; wrapMode: WrapMode; filterMode: 'linear' | 'nearest' };
