import { colorBlendModes } from '@glitch/shared/color-blend.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.js';
import { ParameterEvaluator } from './parameter-evaluator.ts';
import { layerVariables } from './expression-scope.ts';
import type { GsAutomationGraph, ParameterBinding } from '@glitch/shared/types.ts';

export type TimelineCompositingSettings = {
	blendMode: number;
	opacity: number;
	translation: [number, number];
	scale: [number, number];
	rotation: number;
};

export class TimelineCompositingParameters {
	private evaluator = new ParameterEvaluator();

	evaluate(context: { time: number; endTime: number; isExport: boolean; paramValues: Record<string, ParameterBinding>; automationGraphs: GsAutomationGraph[] }): TimelineCompositingSettings {
		const evaluationContext = {
			evaluatedParamValues: null,
			variables: layerVariables({ isExport: context.isExport }),
			automationGraphs: context.automationGraphs,
			time: context.time,
			endTime: context.endTime,
		};
		const values = new Map<string, any>();
		for (const [key, def] of Object.entries(timelineCompositingParamDefs)) {
			const value = context.paramValues[key];
			// 未指定・欠落グラフは設定の既定値、式の失敗は型の空値に戻す。
			values.set(key, value == null ? def.defaultValue.value : this.evaluator.evaluate(value, evaluationContext, value.inputSource === 'automationGraphReference' ? def.defaultValue.value : genEmptyValue(def)));
		}
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
