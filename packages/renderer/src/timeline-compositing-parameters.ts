import { colorBlendModes } from '@glitch/shared/color-blend.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline-compositing.ts';
import type { GsAutomationGraph, VisualModuleParamValues } from '@glitch/shared/types.ts';
import { ParameterEvaluator } from './parameter-evaluator.ts';

export type TimelineCompositingSettings = {
	blendMode: number;
	opacity: number;
	translation: [number, number];
	scale: [number, number];
	rotation: number;
};

export class TimelineCompositingParameters {
	private evaluator = new ParameterEvaluator();

	evaluate(context: { time: number; endTime: number; isExport?: boolean }, paramValues: VisualModuleParamValues,
		automationGraphs: GsAutomationGraph[], resolution: { width: number; height: number }): TimelineCompositingSettings {
		const values = this.evaluator.evaluate({
			...context, paramValues, automationGraphs, resolution,
			paramDefs: timelineCompositingParamDefs, nodes: [], effectDefinitions: {}, inputParamIds: new Set(),
		}).paramValues;
		// 不正な式の型や非有限値をGPUへ流さない。範囲外の有限な位置・倍率は制限しない。
		const number = (id: string, fallback: number) => {
			const value = values.get(id);
			return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
		};
		const mode = values.get('blendMode');
		return {
			blendMode: mode === 'replace' ? 19 : typeof mode === 'string' && Object.hasOwn(colorBlendModes, mode) ? colorBlendModes[mode] : 0,
			opacity: Math.min(1, Math.max(0, number('opacity', 1))),
			translation: [number('translationX', 0), number('translationY', 0)],
			scale: [number('scaleX', 1), number('scaleY', 1)],
			rotation: number('rotation', 0),
		};
	}
}
