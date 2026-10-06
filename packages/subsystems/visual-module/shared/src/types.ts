import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterChangeKind, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { FitMode, WrapMode } from '@gs/shared/types.js';

export type VisualModuleNodeParameterBinding = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type VisualModuleCustomParameterInputBinding = {
	inputSource: 'externalCustomParameterInput';
	parameterId: VisualModuleCustomParameterId;
};

// Visual Module内部でだけ解決できる参照を、共通の値入力に加える。
export type VisualModuleParameterBinding = ValueParameterBinding | VisualModuleNodeParameterBinding | VisualModuleCustomParameterInputBinding;

export type VisualModuleEffectNode = {
	id: string;
	type: 'effect';
	effectId: string;
	isBypass: boolean;
	resolution: EffectResolution;
	params: Record<string, VisualModuleParameterBinding>;

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
	| { type: 'bypass' | 'resolution' };

declare const visualModuleCustomParameterIdentity: unique symbol;

export type VisualModuleCustomParameterId = string & { readonly [visualModuleCustomParameterIdentity]: 'id' };
export type VisualModuleCustomParameterName = string & { readonly [visualModuleCustomParameterIdentity]: 'name' };

// 生成・入力・式との境界でのみ使う。既に分類済みのID/名前を相互変換させない。
// 実在性やスコープ内での可用性を保証する型ではなく、保存形式は通常の文字列のまま。
type UnbrandedString = string & { readonly [visualModuleCustomParameterIdentity]?: never };
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
	id: VisualModuleCustomParameterId;
	nameForReference: VisualModuleCustomParameterName; // expressionから参照するとき用
	// ParameterDefinitionでノード入力を許可する型だけ、Inノードの出力として公開できる。
	canNode: boolean;
};

export type VisualModule = {
	nodes: VisualModuleNode[];
	outputDefs: VisualModuleOutputDef[];
	primaryOutputId: string | null;
	paramDefs: VisualModuleParamDef[];
	primaryInputId: VisualModuleCustomParameterId | null;
	/** 音声の自動割当先。Inノードの画像入力とは独立する。 */
	primaryAudioInputId?: VisualModuleCustomParameterId | null;
	automationGraphs: AutomationGraph[];
};

// レイヤー・live modeからは、モジュール内部のノードやパラメータを参照しない。
export type VisualModuleArgumentBindings = Record<VisualModuleCustomParameterId, ValueParameterBinding>;

export type EffectNodeOf<DEF extends Pick<EffectDefinition, 'id' | 'paramDefs'>> =
	Omit<VisualModuleEffectNode, 'effectId' | 'params'> & {
		effectId: DEF['id'];
		params: {
			[K in keyof DEF['paramDefs']]-?: VisualModuleParameterBinding;
		};
	};

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode: FitMode; wrapMode: WrapMode; filterMode: 'linear' | 'nearest' };
