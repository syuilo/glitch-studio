import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { assertCustomNodeGraphEffectParameterReferenceType } from '@gs/subsystems_custom-node-graph-effect_shared/custom-parameters.ts';
import { CUSTOM_NODE_GRAPH_EFFECT_CUSTOM_PARAMETER_VAR_DEFS } from '@gs/subsystems_custom-node-graph-effect_shared/expression.ts';
import type { CustomNodeGraphEffectParameterBindingEvaluator } from './custom-node-graph-effect-parameter-binding-evaluator.ts';
import type { CustomNodeGraphEffectParameterEvaluationContext, CustomNodeGraphEffectCustomParameterResolver } from './custom-node-graph-effect-parameter-binding-evaluator.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectCustomParameterDefinition, CustomNodeGraphEffectCustomParameterId } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { ExpressionParameterDefinition } from '@gs/shared/parameter/expression-parameter-value.ts';

/** 一回の描画評価だけに属する。時刻・入力・利用インスタンスを跨いで結果を保持しない。 */
export class CustomNodeGraphEffectCustomParameterEvaluator implements CustomNodeGraphEffectCustomParameterResolver {
	private definitionsById: ReadonlyMap<CustomNodeGraphEffectCustomParameterId, CustomNodeGraphEffectCustomParameterDefinition>;
	private definitionsByName: ReadonlyMap<string, CustomNodeGraphEffectCustomParameterDefinition>;
	private evaluated = new Map<CustomNodeGraphEffectCustomParameterId, unknown>();
	private evaluating: CustomNodeGraphEffectCustomParameterDefinition[] = [];
	private scope: CustomNodeGraphEffectParameterEvaluationContext;

	constructor(private customNodeGraphEffect: Pick<CustomNodeGraphEffect, 'customParameterDefs' | 'customParameterValues' | 'paramDefs'>,
		scope: CustomNodeGraphEffectParameterEvaluationContext, private evaluator: CustomNodeGraphEffectParameterBindingEvaluator) {
		const definitions = customNodeGraphEffect.customParameterDefs;
		this.definitionsById = new Map(definitions.map(definition => [definition.id, definition]));
		this.definitionsByName = new Map(definitions.map(definition => [definition.nameForReference, definition]));
		// 評価器は描画間で再利用して解析済みの式を保持するが、評価値と参照スタックは共有しない。
		// 呼び出し元がノードのスコープでも、ノード固有の変数や外部関数を共有値へ漏らさない。
		this.scope = { ...scope, functions: {}, variables: Object.fromEntries(CUSTOM_NODE_GRAPH_EFFECT_CUSTOM_PARAMETER_VAR_DEFS
			.filter(name => Object.hasOwn(scope.variables, name)).map(name => [name, scope.variables[name]])), customParameters: this };
	}

	readByName(name: string): unknown {
		const definition = this.definitionsByName.get(name);
		if (definition == null) throw new Error('Unknown custom parameter: ' + name);
		return this.readById(definition.id);
	}

	readById(id: CustomNodeGraphEffectCustomParameterId, targetDefinition?: ExpressionParameterDefinition): unknown {
		const definition = this.definitionsById.get(id);
		if (definition == null) throw new Error('Custom parameter not found: ' + id);
		if (targetDefinition != null) assertCustomNodeGraphEffectParameterReferenceType(targetDefinition, definition);
		if (this.evaluated.has(id)) return structuredClone(this.evaluated.get(id));
		const cycleStart = this.evaluating.findIndex(parameter => parameter.id === id);
		if (cycleStart >= 0) throw new Error('Circular custom parameter reference: ' + [...this.evaluating.slice(cycleStart), definition].map(parameter => parameter.nameForReference).join(' → '));
		this.evaluating.push(definition);
		try {
			const binding = this.customNodeGraphEffect.customParameterValues[id] ?? definition.defaultValue;
			if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference' && binding.parameterId !== '') {
				const source = this.customNodeGraphEffect.paramDefs.find(parameter => parameter.id === binding.parameterId && !parameter.canNode && parameter.dataType.kind !== 'audioSource');
				if (source == null || !this.scope.evaluatedParamValues.has(source.id)) throw new Error('Public parameter not found or unavailable: ' + binding.parameterId);
				assertCustomNodeGraphEffectParameterReferenceType(definition, source);
			}
			const value = prepareExpressionParameterValue(definition, this.evaluator.evaluate(binding, this.scope, definition.defaultValue.value, definition));
			this.evaluated.set(id, structuredClone(value));
			return structuredClone(value);
		} catch (cause) {
			throw new Error(`Custom parameter ${JSON.stringify(definition.nameForReference)}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		} finally {
			this.evaluating.pop();
		}
	}
}
