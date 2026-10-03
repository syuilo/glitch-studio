import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import type { TimelineParameterBinding } from './parameter-binding.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';

export class TimelineParameterBindingEvaluator {
	private valueEvaluator = new ParameterBindingEvaluator();

	evaluate(binding: TimelineParameterBinding, scope: ParameterEvaluationScope, fallback: any): any {
		// レイヤー入力はEffectレイヤー側でGPU入力として解決する。
		// 保存データ全体の検証は受け入れ時に行い、フレーム・音声サンプルごとには繰り返さない。
		if (!isValueParameterBinding(binding)) throw new Error('Unsupported timeline value parameter input source');
		return this.valueEvaluator.evaluate(binding, scope, fallback);
	}
}
