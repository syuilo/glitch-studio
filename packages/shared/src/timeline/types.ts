import type { GsAutomationGraph, ParameterBinding } from '../types.ts';
import type { timelineCompositingParamDefs } from './timeline-compositing.ts';

export type TimelineVisualModuleLayer = {
	id: string;
	startTimeMs: number;
	endTimeMs: number;
	layerType: 'visualModule';
	visualModuleId: string;
	paramValues: Record<string, Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>>;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, Exclude<ParameterBinding, { inputSource: 'node' | 'externalCustomParameterInput' }>>;
	automationGraphs: GsAutomationGraph[];
};

export type TimelineLayer = TimelineVisualModuleLayer;

export type Timeline = TimelineLayer[];
