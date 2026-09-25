import type { TextureDataType } from './data-type.ts';
import type { AnyOptionSchema, ArrayOptionSchema, EffectOptionSchema, StructOptionSchema } from './effect-definition.ts';
import type { GlobalEnvVariable } from './expression.ts';

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode?: 'stretch' | 'cover' | 'contain'; wrapMode?: 'clamp' | 'repeat' | 'repeatMirrored' | 'transparent'; filterMode?: 'linear' | 'nearest' };
// eslint-disable-next-line @typescript-eslint/naming-convention
export type ParameterBinding_Node = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type ParameterBinding = {
	inputSource: 'literal';
	value: any; // TODO: literalにリネーム？
} | {
	inputSource: 'envVariable';
	variable: GlobalEnvVariable;
} | {
	inputSource: 'expression';
	expression: string;
} | {
	inputSource: 'externalCustomParameterInput';
	parameterId: VisualModuleCustomParameterId;
} | {
	inputSource: 'automationGraphReference';
	automationGraphId: string | null;
	durationMs: number | null; // isNormalizedの場合のみ使用。nullの場合は1000ms。
	offsetMode: 'start' | 'end';
	wrapMode: 'clamp' | 'repeat' | 'repeatMirrored'
} | {
	inputSource: 'automationGraphInline';
	automationGraph: Omit<GsAutomationGraph, 'id' | 'name'>;
	durationMs: number | null; // isNormalizedの場合のみ使用。nullの場合は1000ms。
	offsetMode: 'start' | 'end';
	wrapMode: 'clamp' | 'repeat' | 'repeatMirrored'
} | ParameterBinding_Node;

export type AutomationGraphPlaybackOptions = Pick<Extract<ParameterBinding, { inputSource: 'automationGraphReference' }>, 'durationMs' | 'offsetMode' | 'wrapMode'>;

export type Asset = {
	id: string;
	name: string;
	width: number;
	height: number;
	data: Uint8Array | null;
	fileDataType: string;
	fileData: Blob;
	hash?: string;
};

export type Player = {
	id: string;
	name: string;
	sourceType: null | 'asset' | 'webcam' | 'microphone' | 'liveStream';
	assetId?: Asset['id'] | null;
};

export type EffectParamDef = EffectOptionSchema & {
	defaultValue: ParameterBinding;
};

export type EffectParamDefs = Record<string, EffectParamDef>;

export type GsBezierAnchorPoint = {
	id: string;
	x: number; // 時間(=Time)軸
	y: number; // 値(=Value)軸
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

export type GsAutomationGraph = {
	id: string;
	name: string;
	points: GsBezierAnchorPoint[];
	isNormalized: boolean; // X軸が0~1に正規化されているかどうか。falseの場合はX軸単位がmsであるとみなす
};

export type GsEffectNode = {
	id: string;
	type: 'effect';
	effectId: string;
	isBypass: boolean;
	params: Record<string, ParameterBinding>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsGlobalInNode = {
	id: string;
	type: 'globalIn';

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsGlobalOutNode = {
	id: string;
	type: 'globalOut';
	// キーはVisualModule.outputDefsのID。未設定のポートは未接続として扱う。
	inputs: Record<string, { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null }>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type GsNode = GsEffectNode | GsGlobalInNode | GsGlobalOutNode;

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

type CustomParameterSchema<T = Exclude<EffectOptionSchema, StructOptionSchema | ArrayOptionSchema | AnyOptionSchema>> =
	T extends unknown ? Omit<T, 'canNode' | 'primary'> : never;

export type VisualModule = {
	id: string;
	name: string;
	nodes: GsNode[];
	outputDefs: {
		id: string;
		label: string;
		name: string;
		dataType: TextureDataType;
		isPrimaryOutput: boolean;
	}[];
	paramDefs: (CustomParameterSchema & {
		id: VisualModuleCustomParameterId;
		name: VisualModuleCustomParameterName; // expressionから参照するとき用
		defaultValue: { inputSource: 'literal'; value: any };
		canNode: boolean;
		isPrimaryInput: boolean;
	})[];
	automationGraphs: GsAutomationGraph[];
};

// レイヤー・live modeからは、モジュール内部のノードやパラメータを参照しない。
export type VisualModuleParameterBindings = Record<VisualModuleCustomParameterId, Exclude<ParameterBinding, { type: 'node' | 'externalCustomParameterInput' }>>;

export type TimelineVisualModuleLayer = {
	id: string;
	startTimeMs: number;
	endTimeMs: number;
	layerType: 'visualModule';
	visualModuleId: string;
	paramValues: VisualModuleParameterBindings;
	compositing: TODO;
	automationGraphs: GsAutomationGraph[];
};

export type TimelineLayer = TimelineVisualModuleLayer;

export type Timeline = TimelineLayer[];
