import type { AutomationGraph, ParameterBinding } from '../types.ts';
import type { VisualModule } from '../visual-module/types.ts';
import type { timelineCompositingParamDefs } from './timeline-compositing.ts';
import type { TimelineClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from './clip.ts';
import type { TimelineSceneResolution } from './scene-resolution.ts';
import type { EffectResolution } from '../effect/resolution.ts';

type TimelineLayerBase<Clip extends TimelineClip> = {
	id: string;
	name: string;
	clips: Clip[];
	automationGraphs: AutomationGraph[];
};

type TimelineAudioLayerBase = {
	audioParamValues: { volume: TimelineParameterBinding };
};

type TimelineVisualLayerBase = {
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
};

export type TimelineParameterBinding = Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' | 'layerInput' }>;
export type TimelineEffectParameterBinding = TimelineParameterBinding | Extract<ParameterBinding, { inputSource: 'layerInput' }>;

export type TimelineVisualModuleLayer = TimelineLayerBase<TimelineClip> & TimelineVisualLayerBase & {
	layerType: 'visualModule';
	visualModuleId: string;
	visualModuleParamValues: Record<string, TimelineParameterBinding>;
};

export type TimelineInlineVisualModuleLayer = TimelineLayerBase<TimelineClip> & TimelineVisualLayerBase & {
	layerType: 'inlineVisualModule';
	visualModule: VisualModule;
	visualModuleParamValues: Record<string, TimelineParameterBinding>;
};

export type TimelineEffectLayer = TimelineLayerBase<TimelineClip> & TimelineVisualLayerBase & {
	layerType: 'effect';
	effectId: string;
	effectParamValues: Record<string, TimelineEffectParameterBinding>;
	resolution: EffectResolution;
};

export type TimelineAudioLayer = TimelineLayerBase<TimelineAssetClip> & TimelineAudioLayerBase & {
	layerType: 'audio';
};

/** 静止画像は素材長を持たず、内容時刻は描画に影響しない。 */
export type TimelineImageLayer = TimelineLayerBase<TimelineAssetClip> & TimelineVisualLayerBase & {
	layerType: 'image';
};

/** 映像と音声は同じ素材時刻・トリムを共有する。Playerの再生状態には依存しない。 */
export type TimelineVideoLayer = TimelineLayerBase<TimelineVideoClip> & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'video';
};

/** 参照先は透明背景から描画する。配置期間は参照先の長さが変わっても自動伸縮しない。 */
export type TimelineSceneLayer = TimelineLayerBase<TimelineSceneClip> & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'scene';
};

export type TimelineLayer = TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer | TimelineEffectLayer | TimelineAudioLayer | TimelineImageLayer | TimelineVideoLayer | TimelineSceneLayer;

/** 長さは直下の全クリップの終了時刻の最大値から求め、空の場合は0とする。 */
export type TimelineScene = {
	id: string;
	name: string;
	resolution: TimelineSceneResolution;

	/** UIの上から下への表示順。先頭が最上層で、描画・合成は末尾から先頭へ行う。 */
	layers: TimelineLayer[];
};
