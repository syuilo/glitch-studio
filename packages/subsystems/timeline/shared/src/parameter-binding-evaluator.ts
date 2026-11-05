import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { Cloneable } from '@gs/shared/utility/deep-clone.ts';
import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { resolveTimelineLayerPublicParameterReference, areTimelinePublicParameterTypesCompatible } from './public-parameters.ts';
import { createTimelineLayerEvaluationScope } from './evaluation-scope.ts';
import type { TimelineLayerPublicParameterDefinition, TimelineLayerPublicParameterContext, TimelineLayerPublicParameterOwner } from './public-parameters.ts';
import type { TimelineLayerEvaluationScope } from './evaluation-scope.ts';
import type { TimelineParameterBinding } from './parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/** Timelineの参照を解決してから、ドメイン非依存の値評価へ渡す。評価結果はフレーム間で保持しない。 */
export class TimelineParameterBindingEvaluator {
	private valueEvaluator = new ParameterBindingEvaluator();

	evaluate(binding: TimelineParameterBinding, scope: TimelineLayerEvaluationScope, fallback: any, definition: ParameterDefinition): any {
		const cache = new Map<string, Cloneable>();
		const evaluatePublicParameter = (owner: TimelineLayerPublicParameterOwner, publicParameterDefinition: TimelineLayerPublicParameterDefinition, context: TimelineLayerPublicParameterContext): Cloneable => {
			const key = JSON.stringify([owner.id, publicParameterDefinition.id]);
			if (cache.has(key)) return cache.get(key)!;
			const ownerIndex = context.ancestors.findIndex(ancestor => ancestor.id === owner.id);
			// 所有レイヤーを基準に必ず祖先方向へ進める。呼び出した子の環境を再利用すると、
			// 同名のPARAMが子自身へ戻り、階層だけで保証できる非循環性を失ってしまう。
			const ownerContext = { layer: owner, ancestors: ownerIndex < 0 ? context.ancestors : context.ancestors.slice(0, ownerIndex) };
			const ownerScope = createTimelineLayerEvaluationScope({ time: scope.time, isExport: scope.variables.IS_EXPORT === true, automationGraphs: owner.automationGraphs, publicParameters: ownerContext });
			const value = evaluate(owner.publicParameterValues?.[publicParameterDefinition.id] ?? publicParameterDefinition.defaultValue, ownerScope, publicParameterDefinition.defaultValue.value, publicParameterDefinition, true);
			const result = prepareExpressionParameterValue(publicParameterDefinition, deepClone(value)) as Cloneable;
			cache.set(key, result);
			return result;
		};
		const evaluate = (value: TimelineParameterBinding, environment: TimelineLayerEvaluationScope, defaultValue: any, target: ParameterDefinition, isPublicParameterValue: boolean): any => {
			const context = environment.publicParameters;
			if (value.inputSource === 'timelineLayerPublicParameterReference') {
				if (context == null) return deepClone(target.defaultValue.value);
				const source = resolveTimelineLayerPublicParameterReference(context, value.layerId, value.parameterId, isPublicParameterValue);
				// 削除・階層移動後も保存IDを維持する。Undoで元の祖先へ戻せば再接続できる。
				if (source == null) return deepClone(target.defaultValue.value);
				if (!areTimelinePublicParameterTypesCompatible(target, source.definition)) throw new Error('Timeline public parameter reference type mismatch');
				return deepClone(evaluatePublicParameter(source.layer, source.definition, context));
			}
			return this.valueEvaluator.evaluate(value, {
				...environment,
				functions: {
					...environment.functions,
					PARAM: (...args) => {
						if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('PARAM requires a parameter name');
						const owner = isPublicParameterValue ? context?.ancestors.at(-1) : context?.layer;
						const source = owner?.publicParameterDefs?.find(definition => definition.nameForReference === args[0]);
						if (owner == null || source == null || context == null) throw new Error(`Unknown or unavailable timeline public parameter: ${args[0]}`);
						return deepClone(evaluatePublicParameter(owner, source, context));
					},
				},
			}, defaultValue, target);
		};
		return evaluate(binding, scope, fallback, definition, false);
	}
}
