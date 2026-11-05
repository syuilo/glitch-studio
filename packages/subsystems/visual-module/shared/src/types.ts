import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterChangeKind, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { FitMode, WrapMode } from '@gs/shared/types.js';

export type VisualModuleNodeParameterBinding = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type VisualModulePublicParameterReferenceBinding = {
	inputSource: 'visualModulePublicParameterReference';
	parameterId: VisualModulePublicParameterId;
};

export type VisualModuleCustomParameterReferenceBinding = {
	inputSource: 'visualModuleCustomParameterValueReference';
	parameterId: VisualModuleCustomParameterId;
};

// カスタムパラメータはCPU値だけを共有し、ノードの画像配線は所有しない。
export type VisualModuleValueParameterBinding = ValueParameterBinding | VisualModulePublicParameterReferenceBinding | VisualModuleCustomParameterReferenceBinding;

// Visual Module内部でだけ解決できる参照を、共通の値入力に加える。
export type VisualModuleParameterBinding = VisualModuleValueParameterBinding | VisualModuleNodeParameterBinding;

export type VisualModuleEffectNode = {
	id: string;
	type: 'effect';
	effectId: string;
	isBypass: boolean;
	resolution: EffectResolution;
	params: Record<string, VisualModuleParameterBinding>;
	staticSettings: StaticSettingValues;

	displayName: string;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type VisualModuleGlobalInNode = {
	id: string;
	type: 'globalIn';

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type VisualModuleGlobalOutNode = {
	id: string;
	type: 'globalOut';
	// キーはVisualModule.outputDefsのID。未設定のポートは未接続として扱う。
	inputs: Record<string, { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null }>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type VisualModuleRelayNode = {
	id: string;
	type: 'relay';
	label?: string;
	// 作成時に指定する固定の宣言型。UIの接続判定に使い、レンダラーでは型の強制や変換を行わない。
	dataType: TextureDataType;
	input: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };
	pos?: { x: number; y: number };
};

export type VisualModuleNode = VisualModuleEffectNode | VisualModuleGlobalInNode | VisualModuleGlobalOutNode | VisualModuleRelayNode;

// ノード自身の変更内容だけを表す。所属Moduleや変更後の描画方針は含めない。
export type VisualModuleNodeChange =
	| { type: 'parameter'; kind: ParameterChangeKind }
	| { type: 'bypass' | 'resolution' | 'staticSetting' };

declare const visualModulePublicParameterIdentity: unique symbol;
declare const visualModuleCustomParameterIdentity: unique symbol;

export type VisualModulePublicParameterId = string & { readonly [visualModulePublicParameterIdentity]: 'id' };
export type VisualModulePublicParameterName = string & { readonly [visualModulePublicParameterIdentity]: 'name' };
export type VisualModuleCustomParameterId = string & { readonly [visualModuleCustomParameterIdentity]: 'id' };
export type VisualModuleCustomParameterName = string & { readonly [visualModuleCustomParameterIdentity]: 'name' };

// 生成・入力・式との境界でのみ使う。既に分類済みのID/名前を相互変換させない。
// 実在性やスコープ内での可用性を保証する型ではなく、保存形式は通常の文字列のまま。
type UnbrandedString = string & { readonly [visualModulePublicParameterIdentity]?: never; readonly [visualModuleCustomParameterIdentity]?: never };
export function visualModulePublicParameterId(value: UnbrandedString): VisualModulePublicParameterId {
	return value as unknown as VisualModulePublicParameterId;
}
export function visualModulePublicParameterName(value: UnbrandedString): VisualModulePublicParameterName {
	return value as unknown as VisualModulePublicParameterName;
}
export function visualModuleCustomParameterId(value: UnbrandedString): VisualModuleCustomParameterId {
	return value as unknown as VisualModuleCustomParameterId;
}
export function visualModuleCustomParameterName(value: UnbrandedString): VisualModuleCustomParameterName {
	return value as unknown as VisualModuleCustomParameterName;
}

export type VisualModuleOutputDef = {
	id: string;
	label: string;
	name: string;
	dataType: TextureDataType;
};

export type VisualModuleParamDef = ParameterDefinition & {
	id: VisualModulePublicParameterId;
	nameForReference: VisualModulePublicParameterName; // expressionから参照するとき用
	// ParameterDefinitionでノード入力を許可する型だけ、Inノードの出力として公開できる。
	canNode: boolean;
};

export type VisualModuleCustomParameterDefinition = Extract<ParameterDefinition, { dataType: { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' | 'sizeReference' } }> & {
	id: VisualModuleCustomParameterId;
	nameForReference: VisualModuleCustomParameterName;
	canNode: false;
};

export type VisualModule = {
	nodes: VisualModuleNode[];
	outputDefs: VisualModuleOutputDef[];
	primaryOutputId: string | null;
	paramDefs: VisualModuleParamDef[];
	/** 内部の共通値。未使用時も空の配列・オブジェクトを持ち、公開引数には含めない。 */
	customParameterDefs: VisualModuleCustomParameterDefinition[];
	customParameterValues: Record<VisualModuleCustomParameterId, VisualModuleValueParameterBinding>;
	primaryInputId: VisualModulePublicParameterId | null;
	/** 音声の自動割当先。Inノードの画像入力とは独立する。 */
	primaryAudioInputId?: VisualModulePublicParameterId | null;
	automationGraphs: AutomationGraph[];
};

// レイヤー・Visual Module Live Previewからは、モジュール内部のノードやパラメータを参照しない。
export type VisualModuleArgumentBindings = Record<VisualModulePublicParameterId, ValueParameterBinding>;

export type EffectNodeOf<DEF extends Pick<EffectDefinition, 'id' | 'paramDefs' | 'staticSettingDefs'>> =
	Omit<VisualModuleEffectNode, 'effectId' | 'params' | 'staticSettings'> & {
		effectId: DEF['id'];
		staticSettings: StaticSettingValues<NonNullable<DEF['staticSettingDefs']>>;
		params: {
			[K in keyof DEF['paramDefs']]-?: VisualModuleParameterBinding;
		};
	};

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode: FitMode; wrapMode: WrapMode; filterMode: 'linear' | 'nearest' };
