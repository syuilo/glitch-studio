import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { Cloneable } from '@gs/shared/utility/deep-clone.ts';
import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { resolveTimelineLayerCustomParameterReference, areTimelineCustomParameterTypesCompatible } from './custom-parameters.ts';
import { createTimelineLayerEvaluationScope } from './evaluation-scope.ts';
import type { TimelineLayerCustomParameterDefinition, TimelineLayerCustomParameterContext, TimelineLayerCustomParameterOwner } from './custom-parameters.ts';
import type { TimelineLayerEvaluationScope } from './evaluation-scope.ts';
import type { TimelineParameterBinding } from './parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/** Timelineの参照を解決してから、ドメイン非依存の値評価へ渡す。評価結果はフレーム間で保持しない。 */
export class TimelineParameterBindingEvaluator {
	private valueEvaluator = new ParameterBindingEvaluator();

	evaluate(binding: TimelineParameterBinding, scope: TimelineLayerEvaluationScope, fallback: any, definition: ParameterDefinition): any {
		const cache = new Map<string, Cloneable>();
		const evaluateCustomParameter = (owner: TimelineLayerCustomParameterOwner, customDefinition: TimelineLayerCustomParameterDefinition, context: TimelineLayerCustomParameterContext): Cloneable => {
			const key = JSON.stringify([owner.id, customDefinition.id]);
			if (cache.has(key)) return cache.get(key)!;
			const ownerIndex = context.ancestors.findIndex(ancestor => ancestor.id === owner.id);
			// 所有レイヤーを基準に必ず祖先方向へ進める。呼び出した子の環境を再利用すると、
			// 同名のPARAMが子自身へ戻り、階層だけで保証できる非循環性を失ってしまう。
			const ownerContext = { layer: owner, ancestors: ownerIndex < 0 ? context.ancestors : context.ancestors.slice(0, ownerIndex) };
			const ownerScope = createTimelineLayerEvaluationScope({ time: scope.time, isExport: scope.variables.IS_EXPORT === true, automationGraphs: owner.automationGraphs, customParameters: ownerContext });
			const value = evaluate(owner.customParameterValues?.[customDefinition.id] ?? customDefinition.defaultValue, ownerScope, customDefinition.defaultValue.value, customDefinition, true);
			const result = prepareExpressionParameterValue(customDefinition, deepClone(value)) as Cloneable;
			cache.set(key, result);
			return result;
		};
		const evaluate = (value: TimelineParameterBinding, environment: TimelineLayerEvaluationScope, defaultValue: any, target: ParameterDefinition, isCustomParameterValue: boolean): any => {
			const context = environment.customParameters;
			if (value.inputSource === 'timelineLayerCustomParameterReference') {
				if (context == null) return deepClone(target.defaultValue.value);
				const source = resolveTimelineLayerCustomParameterReference(context, value.layerId, value.parameterId, isCustomParameterValue);
				// 削除・階層移動後も保存IDを維持する。Undoで元の祖先へ戻せば再接続できる。
				if (source == null) return deepClone(target.defaultValue.value);
				if (!areTimelineCustomParameterTypesCompatible(target, source.definition)) throw new Error('Timeline custom parameter reference type mismatch');
				return deepClone(evaluateCustomParameter(source.layer, source.definition, context));
			}
			return this.valueEvaluator.evaluate(value, {
				...environment,
				functions: {
					...environment.functions,
					PARAM: (...args) => {
						if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('PARAM requires a parameter name');
						const owner = isCustomParameterValue ? context?.ancestors.at(-1) : context?.layer;
						const source = owner?.customParameterDefs?.find(definition => definition.nameForReference === args[0]);
						if (owner == null || source == null || context == null) throw new Error(`Unknown or unavailable timeline custom parameter: ${args[0]}`);
						return deepClone(evaluateCustomParameter(owner, source, context));
					},
				},
			}, defaultValue, target);
		};
		return evaluate(binding, scope, fallback, definition, false);
	}
}
