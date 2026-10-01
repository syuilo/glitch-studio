import type { AutomationGraph, ParameterBinding } from '../types.ts';
import type { VisualModule } from '../visual-module/types.ts';
import type { timelineCompositingParamDefs } from './timeline-compositing.ts';
import type { TimelineLayerTiming } from './timing.ts';

// NOTE: 各値の計算式は以下となる
// const visibleStartMs = layer.positionMs + layer.trimStartMs;
// const visibleEndMs = visibleStartMs + layer.trimmedDurationMs;
// const contentTimeMs = timelineTimeMs - layer.positionMs;

type TimelineLayerBase = {
	id: string;
	automationGraphs: AutomationGraph[];
} & TimelineLayerTiming;

type TimelineAudioLayerBase = {
	audioParamValues: { volume: TimelineParameterBinding };
};

type TimelineVisualLayerBase = {
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
};

export type TimelineParameterBinding = Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>;

export type TimelineVisualModuleLayer = TimelineLayerBase & TimelineLayerTiming & TimelineVisualLayerBase & {
	layerType: 'visualModule';
	visualModuleId: string;
	visualModuleParamValues: Record<string, TimelineParameterBinding>;
};

export type TimelineInlineVisualModuleLayer = TimelineLayerBase & TimelineLayerTiming & TimelineVisualLayerBase & {
	layerType: 'inlineVisualModule';
	visualModule: VisualModule;
	visualModuleParamValues: Record<string, TimelineParameterBinding>;
};

export type TimelineEffectLayer = TimelineLayerBase & TimelineLayerTiming & TimelineVisualLayerBase & { // TODO
	layerType: 'effect';
	effectId: string;
	effectParamValues: Record<string, TimelineParameterBinding>;
};

export type TimelineAudioLayer = TimelineLayerBase & TimelineLayerTiming & TimelineAudioLayerBase & {
	layerType: 'audio';
	assetId: string;
};

/** 静止画像は素材長を持たず、表示区間の編集ではtrimStartMsを0に保つ。 */
export type TimelineImageLayer = TimelineLayerBase & TimelineVisualLayerBase & {
	layerType: 'image';
	assetId: string;
};

/** 映像と音声は同じ素材時刻・トリムを共有する。Playerの再生状態には依存しない。 */
export type TimelineVideoLayer = TimelineLayerBase & TimelineLayerTiming & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'video';
	assetId: string;
	audioEnabled: boolean;
};

/** 参照先は透明背景から描画する。配置期間は参照先の長さが変わっても自動伸縮しない。 */
export type TimelineSceneLayer = TimelineLayerBase & TimelineLayerTiming & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'scene';
	sceneId: string;
};

export type TimelineLayer = TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer | TimelineEffectLayer | TimelineAudioLayer | TimelineImageLayer | TimelineVideoLayer | TimelineSceneLayer;

/** 長さは直下のレイヤーの終了時刻の最大値から求め、空の場合は0とする。 */
export type TimelineScene = {
	id: string;
	name: string;

	/** UIの上から下への表示順。先頭が最上層で、描画・合成は末尾から先頭へ行う。 */
	layers: TimelineLayer[];
};
