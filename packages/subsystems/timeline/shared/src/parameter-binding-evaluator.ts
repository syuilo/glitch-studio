import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import type { TimelineParameterBinding } from './parameter-binding.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { ExpressionParameterDefinition } from '@gs/shared/parameter/expression-parameter-value.ts';

export class TimelineParameterBindingEvaluator {
	private valueEvaluator = new ParameterBindingEvaluator();

	evaluate(binding: TimelineParameterBinding, scope: ParameterEvaluationScope, fallback: any, definition?: ExpressionParameterDefinition): any {
		// レイヤー入力はEffectレイヤー側でGPU入力として解決する。
		// 保存データ全体の検証は受け入れ時に行い、フレーム・音声サンプルごとには繰り返さない。
		return this.valueEvaluator.evaluate(binding, scope, fallback, definition);
	}
}
