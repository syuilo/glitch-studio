import type { AutomationGraph, ParameterBinding } from '../types.ts';
import type { timelineCompositingParamDefs } from './timeline-compositing.ts';

export type TimelineVisualModuleLayer = {
	id: string;
	startTimeMs: number;
	endTimeMs: number;
	layerType: 'visualModule';
	visualModuleId: string;
	paramValues: Record<string, Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>>;
	automationGraphs: AutomationGraph[];
};

export type TimelineEffectLayer = {
	id: string;
	startTimeMs: number;
	endTimeMs: number;
	layerType: 'effect';
	effectId: string;
	paramValues: Record<string, Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>>;
	automationGraphs: AutomationGraph[];
};

export type TimelineParameterBinding = Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>;

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

export type TimelineLayer = TimelineVisualModuleLayer | TimelineEffectLayer | TimelineAudioLayer;

export type Timeline = TimelineLayer[];
