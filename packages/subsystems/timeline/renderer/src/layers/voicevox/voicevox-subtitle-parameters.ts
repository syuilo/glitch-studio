import type { TextRenderValues } from '../../text-rendering/text-render-values.ts';
import { voicevoxSubtitleParamDefs } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { VoicevoxSubtitleParameterValues } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';

export class VoicevoxSubtitleParameters {
	private evaluator = new TimelineParameterBindingEvaluator();

	evaluate(text: string, bindings: VoicevoxSubtitleParameterValues, context: { time: number; isExport: boolean; automationGraphs: AutomationGraph[] }): TextRenderValues {
		const scope = createTimelineLayerEvaluationScope(context);
		const values: Record<string, unknown> = {};
		for (const [key, def] of Object.entries(voicevoxSubtitleParamDefs)) {
			const binding = bindings[key as keyof VoicevoxSubtitleParameterValues] ?? def.defaultValue;
			const fallback = binding.inputSource === 'automationGraphReference' || def.dataType.kind === 'enum' ? def.defaultValue.value : genEmptyValue(def);
			values[key] = coerceParameterValue(def, validateEnumParameterValue(def, this.evaluator.evaluate(binding, scope, fallback)));
		}
		// 式が返した値は保存値を変更せず描画境界で整える。色はここでは未乗算。
		const number = (value: unknown) => typeof value === 'number' && Number.isFinite(Math.fround(value)) ? value : 0;
		const components = (value: unknown, count: number) => Array.from({ length: count }, (_, index) => number(Array.isArray(value) ? value[index] : undefined));
		const vector = (value: unknown) => components(value, 2) as [number, number];
		const color = (value: unknown): [number, number, number, number] => {
			const [r, g, b, a] = components(value, 4);
			return [r, g, b, Math.max(0, Math.min(1, a))];
		};
		return {
			text: text.trim(), font: typeof values.font === 'string' ? values.font : null,
			size: Math.max(0, number(values.size)), maxWidth: number(values.maxWidth),
			overflow: values.overflow as TextRenderValues['overflow'], align: values.align as TextRenderValues['align'],
			position: vector(values.position), lineHeight: Math.max(0, number(values.lineHeight)),
			color: color(values.color), outlineColor: color(values.outlineColor), outlineWidth: Math.max(0, number(values.outlineWidth)),
			shadowEnabled: values.shadowEnabled === true, shadowColor: color(values.shadowColor),
			shadowOffset: vector(values.shadowOffset), shadowBlur: Math.max(0, number(values.shadowBlur)),
		};
	}
}
