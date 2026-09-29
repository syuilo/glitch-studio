import type { AutomationGraph, ParameterBinding } from '../types.ts';
import type { VisualModule } from '../visual-module/types.ts';
import type { timelineCompositingParamDefs } from './timeline-compositing.ts';

export type TimelineParameterBinding = Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>;

export type TimelineVisualModuleLayer = {
	id: string;
	startTimeMs: number;
	endTimeMs: number;
	layerType: 'visualModule';
	visualModuleId: string;
	paramValues: Record<string, TimelineParameterBinding>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
	automationGraphs: AutomationGraph[];
};

export type TimelineInlineVisualModuleLayer = {
	id: string;
	startTimeMs: number;
	endTimeMs: number;
	layerType: 'inlineVisualModule';
	visualModule: VisualModule;
	paramValues: Record<string, TimelineParameterBinding>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
	automationGraphs: AutomationGraph[];
};

export type TimelineEffectLayer = { // TODO
	id: string;
	startTimeMs: number;
	endTimeMs: number;
	layerType: 'effect';
	effectId: string;
	paramValues: Record<string, TimelineParameterBinding>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
	automationGraphs: AutomationGraph[];
};

export type TimelineAudioLayer = {
	id: string;
	layerType: 'audio';
	startTimeMs: number;
	endTimeMs: number;
	assetId: string;
	sourceOffsetMs: number;
	paramValues: { volume: TimelineParameterBinding };
	automationGraphs: AutomationGraph[];
};

export type TimelineLayer = TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer | TimelineEffectLayer | TimelineAudioLayer;

/** UIの上から下への表示順。先頭が最上層で、描画・合成は末尾から先頭へ行う。 */
export type Timeline = TimelineLayer[];
