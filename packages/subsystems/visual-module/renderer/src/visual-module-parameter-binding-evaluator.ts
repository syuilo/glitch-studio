import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { visualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { VisualModuleEvaluatedParameterValues } from '@gs/subsystems_visual-module_shared/parameter-evaluation.ts';
import type { VisualModuleCustomParameterId, VisualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';

export type VisualModuleParameterEvaluationContext = ParameterEvaluationScope & {
	// canNode: falseだけを公開する。uniform入力でもInノード用の値は含めない。
	evaluatedParamValues: VisualModuleEvaluatedParameterValues;
	paramIdsByName: ReadonlyMap<VisualModuleCustomParameterName, VisualModuleCustomParameterId>;
};

export class VisualModuleParameterBindingEvaluator {
	private valueEvaluator = new ParameterBindingEvaluator();

	evaluate(binding: ParameterBinding, context: VisualModuleParameterEvaluationContext, fallback: any): any {
		if (binding.inputSource === 'layerInput') throw new Error('Layer input is only available in effect layer parameters');
		if (binding.inputSource === 'node') return binding.nodeId == null ? null : { nodeId: binding.nodeId, outputPort: binding.outputPort };
		if (binding.inputSource === 'externalCustomParameterInput') {
			return context.evaluatedParamValues.has(binding.parameterId) ? deepClone(context.evaluatedParamValues.get(binding.parameterId)) : fallback;
		}
		return this.valueEvaluator.evaluate(binding, {
			...context,
			functions: {
				...context.functions,
				PARAM: (...args) => {
					if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('PARAM requires a parameter name');
					const id = context.paramIdsByName.get(visualModuleCustomParameterName(args[0]));
					if (id == null || !context.evaluatedParamValues.has(id)) throw new Error(`Unknown or unavailable parameter: ${args[0]}`);
					return deepClone(context.evaluatedParamValues.get(id));
				},
			},
		}, fallback);
	}
}
