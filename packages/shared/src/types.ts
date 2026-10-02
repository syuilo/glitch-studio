import type { KeyframesTimelineData } from './keyframes-timeline.ts';
export type { KeyframeInterpolation, KeyframesTimelineKeyframe, KeyframesTimeline } from './keyframes-timeline.ts';

import type { GlobalEnvVariable } from './expression.ts';
import type { NodeOutputReference, VisualModuleCustomParameterId } from './visual-module/types.ts';

// NOTE: externalCustomParameterInput、node、layerInputについては本来的にはこの汎用ParameterBinding型ではなく、各利用ドメイン側で拡張するべきであるが、そこまで厳密に分けると実装が複雑化するため、便宜上ここに含めている
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
	inputSource: 'layerInput'; // エフェクトレイヤーの末端パラメータだけで使う。
	fitMode: FitMode;
	wrapMode: WrapMode;
	filterMode: 'linear' | 'nearest';
} | {
	inputSource: 'externalCustomParameterInput'; // inputSource: 'externalCustomParameterInput'はVisualModule内でしか使わない
	parameterId: VisualModuleCustomParameterId;
} | {
	inputSource: 'automationGraphReference';
	automationGraphId: string | null;
	trimmedDurationMs: number | null; // isNormalizedの場合のみ使用。nullの場合は1000ms。
	offsetMode: 'start' | 'end';
	wrapMode: 'clamp' | 'repeat' | 'repeatMirrored'
} | {
	inputSource: 'automationGraphInline';
	automationGraph: Omit<AutomationGraph, 'id' | 'name'>;
	trimmedDurationMs: number | null; // isNormalizedの場合のみ使用。nullの場合は1000ms。
	offsetMode: 'start' | 'end';
	wrapMode: 'clamp' | 'repeat' | 'repeatMirrored'
} | {
	inputSource: 'keyframesTimelineInline';
	keyframesTimeline: KeyframesTimelineData;
	trimmedDurationMs: number | null; // isNormalizedの場合のみ使用。nullの場合は1000ms。
	offsetMode: 'start' | 'end';
	wrapMode: 'clamp' | 'repeat' | 'repeatMirrored'
} | ({ inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null })); // inputSource: 'node'はVisualModule内でしか使わない

export type AutomationGraphPlaybackOptions = Pick<Extract<ParameterBinding, { inputSource: 'automationGraphReference' }>, 'trimmedDurationMs' | 'offsetMode' | 'wrapMode'>;

export type Asset = {
	id: string;
	name: string;
	width: number;
	height: number;
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

export type BezierAnchorPoint = {
	id: string;
	x: number; // 時間(=Time)軸
	y: number; // 値(=Value)軸
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

export type AutomationGraph = {
	id: string;
	name: string;
	points: BezierAnchorPoint[];
	isNormalized: boolean; // X軸が0~1に正規化されているかどうか。falseの場合はX軸単位がmsであるとみなす
};

// 画像の中間処理でフィルタリング・ブレンド可能なRGBA形式。
export type IntermediateTextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgba16float';

export type WrapMode = 'clamp' | 'repeat' | 'repeatMirrored' | 'transparent';

export type FitMode = 'stretch' | 'cover' | 'contain';
