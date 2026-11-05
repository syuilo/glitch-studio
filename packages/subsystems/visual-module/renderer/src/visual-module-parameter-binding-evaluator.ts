import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { visualModulePublicParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { ExpressionParameterDefinition } from '@gs/shared/parameter/expression-parameter-value.ts';
import type { VisualModuleEvaluatedParameterValues } from '@gs/subsystems_visual-module_shared/parameter-evaluation.ts';
import type { VisualModuleCustomParameterId, VisualModulePublicParameterId, VisualModulePublicParameterName } from '@gs/subsystems_visual-module_shared/types.ts';

export interface VisualModuleCustomParameterResolver {
	readByName(name: string): unknown;
	readById(id: VisualModuleCustomParameterId, definition: ExpressionParameterDefinition): unknown;
}

export type VisualModuleParameterEvaluationContext = ParameterEvaluationScope & {
	// canNode: falseだけを公開する。uniform入力でもInノード用の値は含めない。
	evaluatedParamValues: VisualModuleEvaluatedParameterValues;
	paramIdsByName: ReadonlyMap<VisualModulePublicParameterName, VisualModulePublicParameterId>;
	customParameters?: VisualModuleCustomParameterResolver;
};

export class VisualModuleParameterBindingEvaluator {
	private valueEvaluator = new ParameterBindingEvaluator();

	evaluate(binding: VisualModuleParameterBinding, context: VisualModuleParameterEvaluationContext, fallback: any, definition: ExpressionParameterDefinition): any {
		if (binding.inputSource === 'node') return binding.nodeId == null ? null : { nodeId: binding.nodeId, outputPort: binding.outputPort };
		if (binding.inputSource === 'visualModulePublicParameterReference') {
			return context.evaluatedParamValues.has(binding.parameterId) ? deepClone(context.evaluatedParamValues.get(binding.parameterId)) : fallback;
		}
		if (binding.inputSource === 'visualModuleCustomParameterValueReference') {
			if (binding.parameterId === '') return deepClone(fallback);
			if (context.customParameters == null) throw new Error('Custom parameters are unavailable');
			return context.customParameters.readById(binding.parameterId, definition);
		}
		return this.valueEvaluator.evaluate(binding as ValueParameterBinding, {
			...context,
			functions: {
				...context.functions,
				PUBLIC: (...args) => {
					if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('PUBLIC requires a parameter name');
					const id = context.paramIdsByName.get(visualModulePublicParameterName(args[0]));
					if (id == null || !context.evaluatedParamValues.has(id)) throw new Error(`Unknown or unavailable parameter: ${args[0]}`);
					return deepClone(context.evaluatedParamValues.get(id));
				},
				CUSTOM: (...args) => {
					if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('CUSTOM requires a parameter name');
					if (context.customParameters == null) throw new Error('Custom parameters are unavailable');
					return context.customParameters.readByName(args[0]);
				},
			},
		}, fallback, definition);
	}
}
