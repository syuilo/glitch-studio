import { evaluateAutomationGraph, evalAutomationGraphValue } from '../automation-graph/automation-graph-evaluator.ts';
import { ExpressionEvaluator } from '../expression/expression-evaluator.ts';
import { evaluateKeyframesTimeline } from '../keyframes/keyframes-timeline-evaluator.ts';
import { deepClone } from '../utility/deep-clone.ts';
import type { ExpressionFunction } from '../expression/expression-environment.ts';
import type { ValueParameterBinding } from './value-parameter-binding.ts';
import type { ParameterEvaluationScope } from './parameter-evaluation-scope.ts';

// Evaluatorはstateless/deterministicである必要がある

// 評価結果やスコープは保持せず、同じBindingとスコープから同じ値を返す。
export class ParameterBindingEvaluator {
	private expressionEvaluator = new ExpressionEvaluator();

	private graphReader(scope: ParameterEvaluationScope): ExpressionFunction {
		return (...args) => {
			const [name, coordinate, wrapMode] = args;
			if (args.length !== 3 || typeof name !== 'string' || typeof coordinate !== 'number' || !Number.isFinite(coordinate)
				|| (wrapMode !== 'clamp' && wrapMode !== 'repeat' && wrapMode !== 'repeatMirrored')) {
				throw new Error('GRAPH requires a graph name, finite coordinate and wrap mode');
			}
			const graph = scope.automationGraphs.find(graph => graph.name === name);
			if (graph == null) throw new Error(`Unknown automation graph: ${name}`);
			return evalAutomationGraphValue(graph, coordinate, wrapMode);
		};
	}

	evaluate(binding: ValueParameterBinding, scope: ParameterEvaluationScope, fallback: any): any {
		switch (binding.inputSource) {
			case 'literal': return binding.value;
			case 'envVariable': return Object.hasOwn(scope.variables, binding.variable) ? deepClone(scope.variables[binding.variable]) ?? fallback : fallback;
			case 'expression': return binding.expression ? this.expressionEvaluator.evaluate(binding.expression, {
				variables: scope.variables,
				functions: { ...scope.functions, GRAPH: this.graphReader(scope) },
			}, fallback) : fallback;
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
