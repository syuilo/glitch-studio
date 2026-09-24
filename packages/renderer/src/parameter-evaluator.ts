import * as AiScript from '@syuilo/aiscript';
import { evalAutomationGraphValue } from '@glitch/shared/utility/misc.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { reservedWords, singleVariableExpression } from '@glitch/shared/expression.js';
import type { EffectParamValue, GsAutomationGraph } from '@glitch/shared/types.ts';

// Evaluatorはstateless/deterministicである必要がある

type AutomationGraphInput = Extract<EffectParamValue, { inputSource: 'automationGraphReference' | 'automationGraphInline' }>;
type ReadGraph = (name: string, t: number, wrapMode: AutomationGraphInput['wrapMode']) => number;

function evaluateAutomationGraph(graph: Pick<GsAutomationGraph, 'points' | 'isNormalized'>, input: AutomationGraphInput, context: EvaluationScope): number {
	// 正規化グラフの1をdurationMsに対応付ける。未指定・無効なdurationはUIの初期値と同じ1秒にする。
	const scale = graph.isNormalized
		? (input.durationMs != null && Number.isFinite(input.durationMs) && input.durationMs > 0 ? input.durationMs : 1000)
		: 1;
	let x = context.time / scale;
	// 終了時刻を持たないliveではstartと同じ扱いにし、InfinityによるNaNを避ける。
	// pointsは編集順で保持されるため、配列末尾ではなく最大のXを終端とする。
	if (input.offsetMode === 'end' && Number.isFinite(context.endTime) && graph.points.length > 0) {
		const lastX = graph.points.reduce((last, point) => Math.max(last, point.x), -Infinity);
		x = (context.time - context.endTime) / scale + lastX;
	}
	return evalAutomationGraphValue(graph, x, input.wrapMode);
}

// グラフの再生時刻と、式に公開する変数は独立。親の環境は継承しない。
export type EvaluationScope = {
	variables: Readonly<Record<string, unknown>>;
	automationGraphs: GsAutomationGraph[];
	time: number;
	endTime: number;
};
export type EvaluatedParamValues = ReadonlyMap<string, any>;
export type ParameterEvaluationContext = EvaluationScope & {
	evaluatedParamValues: EvaluatedParamValues | null;
};

// 解析済みASTだけを再利用し、評価環境は式ごとに独立させる。
export class ParameterEvaluator {
	private aisParser = new AiScript.Parser();
	private astCache = new Map<string, AiScript.Ast.Node[]>();

	private evaluateExpression(expression: string, scope: Readonly<Record<string, unknown>>, fallback: any, getGraph: ReadGraph, paramValues: EvaluatedParamValues | null): any {
		try {
			const variableName = singleVariableExpression.exec(expression)?.[1];
			// 現在のスコープにある値だけを直接取得する。0も有効で、prototype由来の名前は含めない。
			// 評価器が提供する関数名を、単独変数の高速経路で上書きしない。
			if (variableName != null && Object.hasOwn(scope, variableName)
				&& variableName !== 'GRAPH' && variableName !== 'PARAM'
				&& !variableName.split(':').some(name => reservedWords.has(name))) {
				return deepClone(scope[variableName]);
			}
			const constants = Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, AiScript.utils.jsToVal(value)]));
			const readGraph = (args: (AiScript.values.Value | undefined)[]) => {
				if (args.length !== 3 || args[0]?.type !== 'str' || args[1]?.type !== 'num' || !Number.isFinite(args[1].value)
					|| args[2]?.type !== 'str' || !['clamp', 'repeat', 'repeatMirrored'].includes(args[2].value)) {
					throw new Error('GRAPH requires a graph name, finite coordinate and wrap mode');
				}
				return AiScript.values.NUM(getGraph(args[0].value, args[1].value, args[2].value as AutomationGraphInput['wrapMode']));
			};
			constants.GRAPH = AiScript.values.FN_NATIVE(readGraph, readGraph);
			if (paramValues != null) {
				const readParam = (args: (AiScript.values.Value | undefined)[]) => {
					if (args.length !== 1 || args[0]?.type !== 'str') throw new Error('PARAM requires a parameter name');
					return AiScript.utils.jsToVal(deepClone(paramValues.get(args[0].value)));
				};
				constants.PARAM = AiScript.values.FN_NATIVE(readParam, readParam);
			}
			const interpreter = new AiScript.Interpreter(constants); // TODO: 式評価ごとにInterpreter生成は無駄感あるからどうにかする(AiScript側にInterpreterインスタンスはそのままでスコープだけリセット(書き換え)するようなAPIが必要かも？)
			const cachedAst = this.astCache.get(expression);
			const ast = cachedAst ?? this.aisParser.parse(expression);
			if (cachedAst == null) this.astCache.set(expression, ast);
			const aisVal = interpreter.execSync(ast);
			return aisVal === undefined ? null : AiScript.utils.valToJs(aisVal);
		} catch {
			return fallback;
		}
	}

	private graphReader(context: EvaluationScope): ReadGraph {
		return (name, t, wrapMode) => {
			const graph = context.automationGraphs.find(graph => graph.name === name);
			if (graph == null) throw new Error(`Unknown automation graph: ${name}`);
			return evalAutomationGraphValue(graph, t, wrapMode);
		};
	}

	public evaluate(targetNonEvaluatedValue: EffectParamValue, context: ParameterEvaluationContext, fallback: any) {
		const readGraph = this.graphReader(context);
		const getEnvironmentVariableValue = (variable: string) => Object.hasOwn(context.variables, variable) ? deepClone(context.variables[variable]) : undefined;

		if (targetNonEvaluatedValue.inputSource === 'literal') return targetNonEvaluatedValue.value;
		if (targetNonEvaluatedValue.inputSource === 'envVariable') return getEnvironmentVariableValue(targetNonEvaluatedValue.variable) ?? fallback;
		if (targetNonEvaluatedValue.inputSource === 'expression') return targetNonEvaluatedValue.expression ? this.evaluateExpression(targetNonEvaluatedValue.expression, context.variables, fallback, readGraph, context.evaluatedParamValues) : fallback;
		if (targetNonEvaluatedValue.inputSource === 'externalParameterInput') {
			if (context.evaluatedParamValues == null || !context.evaluatedParamValues.has(targetNonEvaluatedValue.parameterId)) return fallback;
			return deepClone(context.evaluatedParamValues.get(targetNonEvaluatedValue.parameterId));
		}
		if (targetNonEvaluatedValue.inputSource === 'automationGraphReference') {
			const automationGraph = context.automationGraphs.find(a => a.id === targetNonEvaluatedValue.automationGraphId);
			return automationGraph ? evaluateAutomationGraph(automationGraph, targetNonEvaluatedValue, context) : fallback;
		}
		if (targetNonEvaluatedValue.inputSource === 'automationGraphInline') return evaluateAutomationGraph(targetNonEvaluatedValue.automationGraph, targetNonEvaluatedValue, context);
		return targetNonEvaluatedValue.nodeId == null ? null : { nodeId: targetNonEvaluatedValue.nodeId, outputPort: targetNonEvaluatedValue.outputPort };
	}
}
