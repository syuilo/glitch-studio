import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import type { ExpressionEngine } from '@gs/shared/expression/expression-engine.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { customNodeGraphEffectPublicParameterName } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { ExpressionParameterDefinition } from '@gs/shared/parameter/expression-parameter-value.ts';
import type { CustomNodeGraphEffectEvaluatedParameterValues } from '@gs/subsystems_custom-node-graph-effect_shared/parameter-evaluation.ts';
import type { CustomNodeGraphEffectCustomParameterId, CustomNodeGraphEffectPublicParameterId, CustomNodeGraphEffectPublicParameterName } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';

export interface CustomNodeGraphEffectCustomParameterResolver {
	readByName(name: string): unknown;
	readById(id: CustomNodeGraphEffectCustomParameterId, definition: ExpressionParameterDefinition): unknown;
}

export type CustomNodeGraphEffectParameterEvaluationContext = ParameterEvaluationScope & {
	// canNode: falseだけを公開する。uniform入力でもInノード用の値は含めない。
	evaluatedParamValues: CustomNodeGraphEffectEvaluatedParameterValues;
	paramIdsByName: ReadonlyMap<CustomNodeGraphEffectPublicParameterName, CustomNodeGraphEffectPublicParameterId>;
	customParameters?: CustomNodeGraphEffectCustomParameterResolver;
};

export class CustomNodeGraphEffectParameterBindingEvaluator {
	private readonly valueEvaluator: ParameterBindingEvaluator;

	constructor(expressionEvaluator: ExpressionEngine | null) {
		this.valueEvaluator = new ParameterBindingEvaluator(expressionEvaluator);
	}

	evaluate(binding: CustomNodeGraphEffectParameterBinding, context: CustomNodeGraphEffectParameterEvaluationContext, fallback: any, definition: ExpressionParameterDefinition): any {
		if (binding.inputSource === 'node') return binding.nodeId == null ? null : { nodeId: binding.nodeId, outputPort: binding.outputPort };
		if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
			return context.evaluatedParamValues.has(binding.parameterId) ? deepClone(context.evaluatedParamValues.get(binding.parameterId)) : fallback;
		}
		if (binding.inputSource === 'customNodeGraphEffectCustomParameterValueReference') {
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
					const id = context.paramIdsByName.get(customNodeGraphEffectPublicParameterName(args[0]));
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
