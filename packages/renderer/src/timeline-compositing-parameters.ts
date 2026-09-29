import { colorBlendModes, isBlendMode } from '@glitch/shared/color-blend.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.js';
import { ParameterEvaluator } from '@glitch/shared/parameter-evaluator.js';
import type { AutomationGraph, ParameterBinding } from '@glitch/shared/types.ts';
import type { LAYER_VAR_DEFS } from '@glitch/shared/expression.js';

export type TimelineCompositingSettings = {
	blendMode: number;
	opacity: number;
	translation: [number, number];
	scale: [number, number];
	rotation: number;
};

export class TimelineCompositingParameters {
	private evaluator = new ParameterEvaluator();

	evaluate(context: { time: number; endTime: number; isExport: boolean; paramValues: Record<string, ParameterBinding>; automationGraphs: AutomationGraph[] }): TimelineCompositingSettings {
		const evaluationContext = {
			evaluatedParamValues: null,
			variables: {
				TEST_ONLY_LAYER: true,
				TEST_SAME_NAME: 2,
				IS_EXPORT: context.isExport,
			} satisfies Record<typeof LAYER_VAR_DEFS[number], unknown>,
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
		const vector = (id: string, fallback: [number, number]): [number, number] => {
			const value = values.get(id);
			return fallback.map((component, index) => Array.isArray(value) && typeof value[index] === 'number' && Number.isFinite(value[index]) ? value[index] : component) as [number, number];
		};
		const mode = values.get('blendMode');
		return {
			blendMode: isBlendMode(mode) ? colorBlendModes[mode] : 0,
			opacity: Math.min(1, Math.max(0, number('opacity', 1))),
			translation: vector('translation', [0, 0]),
			scale: vector('scale', [1, 1]),
			rotation: number('rotation', 0),
		};
	}
}
