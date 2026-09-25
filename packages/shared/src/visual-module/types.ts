import type { TextureDataType } from '../data-type.ts';
import type { EffectDefinition } from '../effect/effect-definition.ts';
import type { ParameterDefinition, ParameterDefinition_Any, ParameterDefinition_Array, ParameterDefinition_Struct } from '../parameter.ts';
import type { FitMode, GsAutomationGraph, ParameterBinding, WrapMode } from '../types.ts';

export type VisualModuleEffectNode = {
	id: string;
	type: 'effect';
	effectId: string;
	isBypass: boolean;
	params: Record<string, ParameterBinding>;

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

export type VisualModuleNode = VisualModuleEffectNode | VisualModuleGlobalInNode | VisualModuleGlobalOutNode;

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

type CustomParameterSchema<T = Exclude<ParameterDefinition, ParameterDefinition_Struct | ParameterDefinition_Array | ParameterDefinition_Any>> =
	T extends unknown ? Omit<T, 'canNode'> : never;

export type VisualModule = {
	id: string;
	name: string;
	nodes: VisualModuleNode[];
	outputDefs: {
		id: string;
		label: string;
		name: string;
		dataType: TextureDataType;
		isPrimaryOutput: boolean;
	}[];
	paramDefs: (CustomParameterSchema & {
		id: VisualModuleCustomParameterId;
		nameForReference: VisualModuleCustomParameterName; // expressionから参照するとき用
		canNode: boolean;
		isPrimaryInput: boolean;
	})[];
	automationGraphs: GsAutomationGraph[];
};

// レイヤー・live modeからは、モジュール内部のノードやパラメータを参照しない。
export type VisualModuleParameterBindings = Record<VisualModuleCustomParameterId, Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>>;

export type EffectNodeOf<DEF extends Pick<EffectDefinition, 'id' | 'paramDefs'>> =
	Omit<VisualModuleEffectNode, 'effectId' | 'params'> & {
		effectId: DEF['id'];
		params: {
			[K in keyof DEF['paramDefs']]-?: ParameterBinding;
		};
	};

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode: FitMode; wrapMode: WrapMode; filterMode: 'linear' | 'nearest' };
