import { getShapeParameterDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import type { Shape, EvaluatedShape } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';

export class ShapeParameters {
	private evaluator = new TimelineParameterBindingEvaluator();

	evaluate(shape: Shape, context: { time: number; isExport: boolean; automationGraphs: AutomationGraph[] }): EvaluatedShape {
		const scope = createTimelineLayerEvaluationScope(context);
		const definitions = getShapeParameterDefinitions(shape.type);
		const bindings: Record<string, ValueParameterBinding> = shape.paramValues;
		const values: Record<string, unknown> = {};
		for (const [key, def] of Object.entries(definitions)) {
			const binding = bindings[key] ?? def.defaultValue;
			const fallback = binding.inputSource === 'automationGraphReference' || def.dataType.kind === 'enum' ? def.defaultValue.value : genEmptyValue(def);
			values[key] = coerceParameterValue(def, this.evaluator.evaluate(binding, scope, fallback));
		}
		// 式は任意の型を返せる。保存値は変更せず、GPUへ渡す境界で有限なf32だけを採用する。
		const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(Math.fround(value)) ? value : fallback;
		const components = (value: unknown, count: number) => Array.from({ length: count }, (_, index) => number(Array.isArray(value) ? value[index] : undefined));
		const size = components(values.size, 2).map(value => Math.max(0, value)) as [number, number];
		const color = (value: unknown, enabled: unknown): [number, number, number, number] => {
			const [r, g, b, alpha] = components(value, 4);
			// 色はここでは未乗算のまま。描画時に被覆率も含めて一度だけpremultiplyする。
			return [r, g, b, enabled === true ? Math.max(0, Math.min(1, alpha)) : 0];
		};
		const common = {
			position: components(values.position, 2) as [number, number],
			rotation: number(values.rotation) % 2,
			fillColor: color(values.fillColor, values.fillEnabled),
			strokeColor: color(values.strokeColor, values.strokeEnabled),
			strokeWidth: values.strokeEnabled === true ? Math.max(0, number(values.strokeWidth)) : 0,
			strokeProgress: Math.max(0, Math.min(1, number(values.strokeProgress))),
			strokeStart: Math.max(0, Math.min(1, number(values.strokeStart))),
			strokeAlignment: values.strokeAlignment === 'inside' || values.strokeAlignment === 'outside' ? values.strokeAlignment : 'center',
		} satisfies Omit<EvaluatedShape, 'type' | 'size'>;
		return shape.type === 'ellipse' ? { ...common, type: 'ellipse', size } : {
			...common, type: 'rectangle', size,
			cornerRadius: Math.max(0, Math.min(number(values.cornerRadius), size[0] / 2, size[1] / 2)),
		};
	}
}
