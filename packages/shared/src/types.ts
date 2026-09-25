
import type { GlobalEnvVariable } from './expression.ts';
import type { NodeOutputReference, VisualModuleCustomParameterId } from './visual-module/types.ts';

// NOTE: externalCustomParameterInputやnodeについては本来的にはこの汎用ParameterBinding型ではなく、VisualModuleドメイン側でこの型を拡張して定義するべきであるが、そこまで厳密に分けると実装が複雑化するため、便宜上ここに含めている
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
	inputSource: 'externalCustomParameterInput'; // inputSource: 'externalCustomParameterInput'はVisualModule内でしか使わない
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
} | ({ inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null })); // inputSource: 'node'はVisualModule内でしか使わない

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

// 画像の中間処理でフィルタリング・ブレンド可能なRGBA形式。
export type IntermediateTextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgba16float';

export type WrapMode = 'clamp' | 'repeat' | 'repeatMirrored' | 'transparent';

export type FitMode = 'stretch' | 'cover' | 'contain';
