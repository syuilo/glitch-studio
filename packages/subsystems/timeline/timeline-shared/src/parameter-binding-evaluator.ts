import { isValueParameterBinding } from '@glitch/shared/parameter/parameter-binding.ts';
import { ParameterBindingEvaluator } from '@glitch/shared/parameter/parameter-binding-evaluator.ts';
import type { ParameterBinding } from '@glitch/shared/parameter/parameter-binding.ts';
import type { ParameterEvaluationScope } from '@glitch/shared/parameter/parameter-evaluation-scope.ts';

export class TimelineParameterBindingEvaluator {
	private valueEvaluator = new ParameterBindingEvaluator();

	evaluate(binding: ParameterBinding, scope: ParameterEvaluationScope, fallback: any): any {
		// レイヤー入力はEffectレイヤー側でGPU入力として解決する。
		// 保存データ全体の検証は受け入れ時に行い、フレーム・音声サンプルごとには繰り返さない。
		if (!isValueParameterBinding(binding)) throw new Error('Unsupported timeline value parameter input source');
		return this.valueEvaluator.evaluate(binding, scope, fallback);
	}
}
