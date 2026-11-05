import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { assertVisualModuleParameterReferenceType } from '@gs/subsystems_visual-module_shared/custom-parameters.ts';
import { VISUAL_MODULE_CUSTOM_PARAMETER_VAR_DEFS } from '@gs/subsystems_visual-module_shared/expression.ts';
import type { VisualModuleParameterBindingEvaluator } from './visual-module-parameter-binding-evaluator.ts';
import type { VisualModuleParameterEvaluationContext, VisualModuleCustomParameterResolver } from './visual-module-parameter-binding-evaluator.ts';
import type { VisualModule, VisualModuleCustomParameterDefinition, VisualModuleCustomParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ExpressionParameterDefinition } from '@gs/shared/parameter/expression-parameter-value.ts';

/** 一回の描画評価だけに属する。時刻・入力・利用インスタンスを跨いで結果を保持しない。 */
export class VisualModuleCustomParameterEvaluator implements VisualModuleCustomParameterResolver {
	private definitionsById: ReadonlyMap<VisualModuleCustomParameterId, VisualModuleCustomParameterDefinition>;
	private definitionsByName: ReadonlyMap<string, VisualModuleCustomParameterDefinition>;
	private evaluated = new Map<VisualModuleCustomParameterId, unknown>();
	private evaluating: VisualModuleCustomParameterDefinition[] = [];
	private scope: VisualModuleParameterEvaluationContext;

	constructor(private visualModule: Pick<VisualModule, 'customParameterDefs' | 'customParameterValues' | 'paramDefs'>,
		scope: VisualModuleParameterEvaluationContext, private evaluator: VisualModuleParameterBindingEvaluator) {
		const definitions = visualModule.customParameterDefs;
		this.definitionsById = new Map(definitions.map(definition => [definition.id, definition]));
		this.definitionsByName = new Map(definitions.map(definition => [definition.nameForReference, definition]));
		// 評価器は描画間で再利用して解析済みの式を保持するが、評価値と参照スタックは共有しない。
		// 呼び出し元がノードのスコープでも、ノード固有の変数や外部関数を共有値へ漏らさない。
		this.scope = { ...scope, functions: {}, variables: Object.fromEntries(VISUAL_MODULE_CUSTOM_PARAMETER_VAR_DEFS
			.filter(name => Object.hasOwn(scope.variables, name)).map(name => [name, scope.variables[name]])), customParameters: this };
	}

	readByName(name: string): unknown {
		const definition = this.definitionsByName.get(name);
		if (definition == null) throw new Error('Unknown custom parameter: ' + name);
		return this.readById(definition.id);
	}

	readById(id: VisualModuleCustomParameterId, targetDefinition?: ExpressionParameterDefinition): unknown {
		const definition = this.definitionsById.get(id);
		if (definition == null) throw new Error('Custom parameter not found: ' + id);
		if (targetDefinition != null) assertVisualModuleParameterReferenceType(targetDefinition, definition);
		if (this.evaluated.has(id)) return structuredClone(this.evaluated.get(id));
		const cycleStart = this.evaluating.findIndex(parameter => parameter.id === id);
		if (cycleStart >= 0) throw new Error('Circular custom parameter reference: ' + [...this.evaluating.slice(cycleStart), definition].map(parameter => parameter.nameForReference).join(' → '));
		this.evaluating.push(definition);
		try {
			const binding = this.visualModule.customParameterValues[id] ?? definition.defaultValue;
			if (binding.inputSource === 'visualModulePublicParameterReference' && binding.parameterId !== '') {
				const source = this.visualModule.paramDefs.find(parameter => parameter.id === binding.parameterId && !parameter.canNode && parameter.dataType.kind !== 'audioSource');
				if (source == null || !this.scope.evaluatedParamValues.has(source.id)) throw new Error('Public parameter not found or unavailable: ' + binding.parameterId);
				assertVisualModuleParameterReferenceType(definition, source);
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
