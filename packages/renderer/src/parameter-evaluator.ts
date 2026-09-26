import { visualModuleCustomParameterName, type VisualModuleCustomParameterId, type VisualModuleCustomParameterName } from '@glitch/shared/visual-module/types.ts';
import * as AiScript from '@syuilo/aiscript';
import { evalAutomationGraphValue } from '@glitch/shared/utility/misc.ts';
import { deepClone, type Cloneable } from '@glitch/shared/utility/deep-clone.js';
import { reservedWords, singleVariableExpression } from '@glitch/shared/expression.js';
import { evaluateKeyframesTimeline } from '@glitch/shared/utility/keyframes-timeline.ts';
import type { ParameterBinding, AutomationGraph } from '@glitch/shared/types.ts';

// Evaluatorはstateless/deterministicである必要がある
// NOTE: PARAM関数はcanNode: falseなカスタムパラメータしか対応しない

type AutomationGraphInput = Extract<ParameterBinding, { inputSource: 'automationGraphReference' | 'automationGraphInline' }>;
type ReadGraph = (name: string, t: number, wrapMode: AutomationGraphInput['wrapMode']) => number;

function evaluateAutomationGraph(graph: Pick<AutomationGraph, 'points' | 'isNormalized'>, input: AutomationGraphInput, context: EvaluationScope): number {
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
	variables: Readonly<Record<string, Cloneable>>;
	automationGraphs: AutomationGraph[];
	time: number;
	endTime: number;
};
export type EvaluatedParameterValues = ReadonlyMap<VisualModuleCustomParameterId, any>;
export type ParameterEvaluationContext = EvaluationScope & {
	evaluatedParamValues: EvaluatedParameterValues | null;
	// PARAMは名前、外部入力参照はIDで解決する。値そのものは再評価しない。
	paramIdsByName?: ReadonlyMap<VisualModuleCustomParameterName, VisualModuleCustomParameterId>;
};

// 解析済みASTだけを再利用し、評価環境は式ごとに独立させる。
export class ParameterEvaluator {
	private aisParser = new AiScript.Parser();
	private astCache = new Map<string, AiScript.Ast.Node[]>();

	private evaluateExpression(expression: string, scope: Readonly<Record<string, Cloneable>>, fallback: any, getGraph: ReadGraph, paramValues: EvaluatedParameterValues | null, paramIdsByName?: ReadonlyMap<VisualModuleCustomParameterName, VisualModuleCustomParameterId>): any {
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
					const id = paramIdsByName?.get(visualModuleCustomParameterName(args[0].value));
					if (id == null || !paramValues.has(id)) throw new Error(`Unknown or unavailable parameter: ${args[0].value}`);
					return AiScript.utils.jsToVal(deepClone(paramValues.get(id)));
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

	/**
	 * 渡されたparameterBindingを評価した結果を返す
	 */
	public evaluate(parameterBinding: ParameterBinding, context: ParameterEvaluationContext, fallback: any) {
		const readGraph = this.graphReader(context);
		const getEnvironmentVariableValue = (variable: string) => Object.hasOwn(context.variables, variable) ? deepClone(context.variables[variable]) : undefined;

		if (parameterBinding.inputSource === 'literal') return parameterBinding.value;
		if (parameterBinding.inputSource === 'envVariable') return getEnvironmentVariableValue(parameterBinding.variable) ?? fallback;
		if (parameterBinding.inputSource === 'expression') return parameterBinding.expression ? this.evaluateExpression(parameterBinding.expression, context.variables, fallback, readGraph, context.evaluatedParamValues, context.paramIdsByName) : fallback;
		if (parameterBinding.inputSource === 'externalCustomParameterInput') {
			if (context.evaluatedParamValues == null || !context.evaluatedParamValues.has(parameterBinding.parameterId)) return fallback;
			return deepClone(context.evaluatedParamValues.get(parameterBinding.parameterId));
		}
		if (parameterBinding.inputSource === 'automationGraphReference') {
			const automationGraph = context.automationGraphs.find(a => a.id === parameterBinding.automationGraphId);
			return automationGraph ? evaluateAutomationGraph(automationGraph, parameterBinding, context) : fallback;
		}
		if (parameterBinding.inputSource === 'automationGraphInline') return evaluateAutomationGraph(parameterBinding.automationGraph, parameterBinding, context);
		if (parameterBinding.inputSource === 'keyframesTimelineInline') return evaluateKeyframesTimeline(parameterBinding, context.time, context.endTime, fallback);
		return parameterBinding.nodeId == null ? null : { nodeId: parameterBinding.nodeId, outputPort: parameterBinding.outputPort };
	}
}
