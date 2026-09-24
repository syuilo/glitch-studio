import type { TextureDataType } from './data-type.ts';
import type { EffectOptionSchema, VisualModuleParamDef } from './effect-definition.ts';
import type { GlobalEnvVariable } from './expression.ts';

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode?: 'stretch' | 'cover' | 'contain'; wrapMode?: 'clamp' | 'repeat' | 'repeatMirrored' | 'transparent'; filterMode?: 'linear' | 'nearest' };
export type NodeParamValue = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type EffectParamValue = {
	inputSource: 'literal';
	value: any; // TODO: literalにリネーム？
} | {
	inputSource: 'envVariable';
	variable: GlobalEnvVariable;
} | {
	inputSource: 'expression';
	expression: string;
} | {
	inputSource: 'externalParameterInput';
	parameterId: string;
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
} | NodeParamValue;

export type AutomationGraphPlaybackOptions = Pick<Extract<EffectParamValue, { inputSource: 'automationGraphReference' }>, 'durationMs' | 'offsetMode' | 'wrapMode'>;

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
	defaultValue: EffectParamValue;
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
	params: Record<string, EffectParamValue>;

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
	paramDefs: VisualModuleParamDef[];
	automationGraphs: GsAutomationGraph[];
};

// レイヤー・live modeからは、モジュール内部のノードやパラメータを参照しない。
export type VisualModuleParamValues = Record<string, Exclude<EffectParamValue, { type: 'node' | 'externalParameterInput' }>>;

export type TimelineVisualModuleLayer = {
	id: string;
	startTimeMs: number;
	endTimeMs: number;
	layerType: 'visualModule';
	visualModuleId: string;
	paramValues: VisualModuleParamValues;
	// 未設定の項目はtimelineCompositingParamDefsの既定値を使用する。
	compositing: VisualModuleParamValues;
	// モジュールへの外部パラメータとレイヤー合成設定だけが参照できるグラフ。
	automationGraphs: GsAutomationGraph[];
};

export type TimelineLayer = TimelineVisualModuleLayer;

export type Timeline = TimelineLayer[];
