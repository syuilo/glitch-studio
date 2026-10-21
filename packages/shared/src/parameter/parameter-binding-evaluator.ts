import { evaluateAutomationGraph, evalAutomationGraphValue } from '../automation-graph/automation-graph-evaluator.ts';
import { ExpressionEvaluator } from '../expression/expression-evaluator.ts';
import { randomExpressionFunctions } from '../expression/random-functions.ts';
import { evaluateKeyframesTimeline } from '../keyframes/keyframes-timeline-evaluator.ts';
import { deepClone } from '../utility/deep-clone.ts';
import type { Cloneable } from '../utility/deep-clone.ts';
import { prepareExpressionParameterValue } from './expression-parameter-value.ts';
import type { ExpressionParameterDefinition } from './expression-parameter-value.ts';
import type { ExpressionFunction } from '../expression/expression-environment.ts';
import type { ValueParameterBinding } from './value-parameter-binding.ts';
import type { ParameterEvaluationScope } from './parameter-evaluation-scope.ts';

// Evaluatorはstateless/deterministicである必要がある

// 評価結果やスコープは保持せず、同じBindingとスコープから同じ値を返す。
export class ParameterBindingEvaluator {
	private expressionEvaluator = new ExpressionEvaluator();

	private graphReader(scope: ParameterEvaluationScope): ExpressionFunction {
		return (...args) => {
			const [nameForReference, coordinate, wrapMode] = args;
			if (args.length !== 3 || typeof nameForReference !== 'string' || typeof coordinate !== 'number' || !Number.isFinite(coordinate)
				|| (wrapMode !== 'clamp' && wrapMode !== 'repeat' && wrapMode !== 'repeatMirrored')) {
				throw new Error('GRAPH requires a nameForReference, finite coordinate and wrap mode');
			}
			const graph = scope.automationGraphs.find(graph => graph.nameForReference === nameForReference);
			if (graph == null) throw new Error(`Unknown automation graph nameForReference: ${nameForReference}`);
			return evalAutomationGraphValue(graph, coordinate, wrapMode);
		};
	}

	evaluate(binding: ValueParameterBinding, scope: ParameterEvaluationScope, fallback: any, definition?: ExpressionParameterDefinition): any {
		const base = this.evaluateSource(binding, scope, fallback, definition);
		const modifier = binding.expressionModifier;
		if (modifier == null || !modifier.enabled) return base;
		try {
			const value = definition == null ? base : prepareExpressionParameterValue(definition, base);
			return this.evaluateExpression(modifier.code, scope, 'modifier', definition, value);
		} catch (error) {
			// 基準値の型変換で失敗した場合も、どのパラメータの加工に失敗したかを残す。
			if (error instanceof ParameterExpressionError) throw error;
			throw new ParameterExpressionError('modifier', definition, error);
		}
	}

	private evaluateExpression(code: string, scope: ParameterEvaluationScope, stage: 'base' | 'modifier', definition?: ExpressionParameterDefinition, value?: unknown): any {
		try {
			const variables = { ...scope.variables };
			const functions = { ...scope.functions, ...randomExpressionFunctions, GRAPH: this.graphReader(scope) };
			// VALUEは加工式だけに公開する。親スコープの同名変数・関数を基準式へ漏らさない。
			delete variables.VALUE;
			delete (functions as Record<string, ExpressionFunction>).VALUE;
			if (stage === 'modifier') variables.VALUE = deepClone(value as Cloneable);
			const result = this.expressionEvaluator.evaluate(code, { variables, functions });
			return definition == null ? result : prepareExpressionParameterValue(definition, result);
		} catch (error) {
			throw new ParameterExpressionError(stage, definition, error);
		}
	}

	private evaluateSource(binding: ValueParameterBinding, scope: ParameterEvaluationScope, fallback: any, definition?: ExpressionParameterDefinition): any {
		switch (binding.inputSource) {
			case 'literal': return binding.value;
			case 'envVariable': return Object.hasOwn(scope.variables, binding.variable) ? deepClone(scope.variables[binding.variable]) ?? fallback : fallback;
			case 'expression': return this.evaluateExpression(binding.expression, scope, 'base', definition);
			case 'automationGraphReference': {
				const graph = scope.automationGraphs.find(graph => graph.id === binding.automationGraphId);
				return graph ? evaluateAutomationGraph(graph, binding, scope.time, scope.endTime) : fallback;
			}
			case 'automationGraphInline': return evaluateAutomationGraph(binding.automationGraph, binding, scope.time, scope.endTime);
			case 'keyframesTimelineInline': return evaluateKeyframesTimeline(binding.keyframesTimeline, binding, scope.time, scope.endTime, fallback);
			default: throw new Error('Unsupported value parameter input source');
		}
	}
}

// エンジンはScene・ノード・レイヤーを知らない。ここでは式の段階とパラメータ名だけを付加し、
// 上位のレンダラーが持つ所在情報と組み合わせて、通常のレンダリング失敗として通知する。
class ParameterExpressionError extends Error {
	constructor(stage: 'base' | 'modifier', definition: ExpressionParameterDefinition | undefined, cause: unknown) {
		const parameter = definition == null ? '' : ` for parameter ${JSON.stringify(definition.ui.label)}`;
		super(`${stage === 'base' ? 'Base' : 'Modifier'} expression${parameter}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
	}
}
