import type { AutomationGraph, ParameterBinding } from '../types.ts';
import type { TimelineLayerTiming } from './timing.ts';
import type { VisualModule } from '../visual-module/types.ts';
import type { timelineCompositingParamDefs } from './timeline-compositing.ts';

// NOTE: 各値の計算式は以下となる
// const visibleStartMs = layer.positionMs + layer.trimStartMs;
// const visibleEndMs = visibleStartMs + layer.trimmedDurationMs;
// const contentTimeMs = timelineTimeMs - layer.positionMs;

export type TimelineParameterBinding = Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>;

export type TimelineVisualModuleLayer = TimelineLayerTiming & {
	id: string;
	layerType: 'visualModule';
	visualModuleId: string;
	paramValues: Record<string, TimelineParameterBinding>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
	automationGraphs: AutomationGraph[];
};

export type TimelineInlineVisualModuleLayer = TimelineLayerTiming & {
	id: string;
	layerType: 'inlineVisualModule';
	visualModule: VisualModule;
	paramValues: Record<string, TimelineParameterBinding>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
	automationGraphs: AutomationGraph[];
};

export type TimelineEffectLayer = TimelineLayerTiming & { // TODO
	id: string;
	layerType: 'effect';
	effectId: string;
	paramValues: Record<string, TimelineParameterBinding>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
	automationGraphs: AutomationGraph[];
};

export type TimelineAudioLayer = TimelineLayerTiming & {
	id: string;
	layerType: 'audio';
	assetId: string;
	paramValues: { volume: TimelineParameterBinding };
	automationGraphs: AutomationGraph[];
};

/** 参照先は透明背景から描画する。配置期間は参照先の長さが変わっても自動伸縮しない。 */
export type TimelineSceneLayer = TimelineLayerTiming & {
	id: string;
	layerType: 'scene';
	sceneId: string;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
	/** 子の音声全体への音量。映像のopacity・変形・合成方法とは独立する。 */
	audioParamValues: { volume: TimelineParameterBinding };
	automationGraphs: AutomationGraph[];
};

export type TimelineLayer = TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer | TimelineEffectLayer | TimelineAudioLayer | TimelineSceneLayer;

/** 長さは直下のレイヤーの終了時刻の最大値から求め、空の場合は0とする。 */
export type TimelineScene = {
	id: string;
	name: string;

	/** UIの上から下への表示順。先頭が最上層で、描画・合成は末尾から先頭へ行う。 */
	layers: TimelineLayer[];
};
