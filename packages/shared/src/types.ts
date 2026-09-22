import type { TextureDataType } from './data-type.ts';
import type { EffectOptionSchema, VisualModuleParamDef } from './effect-definition.ts';

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode?: string; wrapMode?: string };
export type NodeParamValue = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type EffectParamValue = {
	inputSource: 'literal';
	value: any; // TODO: literalにリネーム？
} | {
	inputSource: 'envVariable';
	variable: string;
} | {
	inputSource: 'expression';
	expression: string;
} | {
	inputSource: 'externalParameterInput';
	parameterId: string;
} | {
	inputSource: 'automationReference';
	automationId: string | null;
	durationMs: number | null; // automationが0~1に正規化されている場合に指定。nullの場合はautomation単位がmsであるとみなす
	playMode: 'start' | 'end' | 'repeat' | 'repeatMirrored';
} | {
	inputSource: 'automationInline';
	automation: Omit<GsAutomation, 'id' | 'name'>;
	durationMs: number | null; // automationが0~1に正規化されている場合に指定。nullの場合はautomation単位がmsであるとみなす
	playMode: 'start' | 'end' | 'repeat' | 'repeatMirrored';
} | NodeParamValue;

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

export type GsAutomation = {
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
	automations: GsAutomation[];
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
};

export type TimelineLayer = TimelineVisualModuleLayer;

export type Timeline = TimelineLayer[];
