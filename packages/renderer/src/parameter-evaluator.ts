import * as AiScript from '@syuilo/aiscript';
import { evalAutomationGraphValue, genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { reservedWords, singleVariableExpression, type globalEnvVarDefs } from '@glitch/shared/expression.js';
import { mapNodeParam } from './utility/node-params.ts';
import type { EffectDefinition, EffectOptionSchema, VisualModuleParamDef } from '@glitch/shared/effect-definition.js';
import type { EffectParamValue, GsAutomationGraph, GsEffectNode, GsNode, VisualModule, VisualModuleParamValues } from '@glitch/shared/types.ts';

type AutomationGraphInput = Extract<EffectParamValue, { inputSource: 'automationGraphReference' | 'automationGraphInline' }>;
type ReadGraph = (name: string, t: number, wrapMode: AutomationGraphInput['wrapMode']) => number;

function evaluateAutomationGraph(graph: Pick<GsAutomationGraph, 'points' | 'isNormalized'>, input: AutomationGraphInput, context: ParameterEvaluationContext): number {
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

export type ParameterEvaluationContext = {
	isExport?: boolean;
	nodes: GsNode[];
	paramDefs: VisualModule['paramDefs'];
	effectDefinitions: Record<string, EffectDefinition>;
	automationGraphs: GsAutomationGraph[];
	resolution: { width: number; height: number; };
	time: number;
	endTime: number; // 終了時刻という概念がないコンテキスト(例: live mode)の場合はInfinityとすること。
	paramValues: VisualModuleParamValues;
	// ノード出力はCPU式の値とは分ける。上流が定数でもPARAMの可否を変えないため、
	// uniform/textureの種別ではなく、入力として供給されたパラメータのIDを受け取る。
	inputParamIds: ReadonlySet<string>;
};

export type EvaluatedParameters = {
	paramValues: Map<string, any>;
	nodeParams: Map<GsNode['id'], Record<string, any>>;
};

// GPUリソースの生成・書き込みを行わず、各フレームの評価結果を返す。
// Interpreterはモジュールごとに所有し、従来どおり評価間で使い回す。
export class ParameterEvaluator {
	private aisParser = new AiScript.Parser();
	private aiscript = new AiScript.Interpreter({});
	private astCache = new Map<string, AiScript.Ast.Node[]>();

	// パフォーマンス上の理由でインタプリタは使いまわすが、毎回スコープは上書きしてるので特に問題ないはず
	// (本来ならスコープ的にアクセスできない値にアクセスできる可能性が生まれるのは許容する)
	private evaluateExpression(expression: string, scope: Record<string, any>, paramDefForFallback: EffectOptionSchema | VisualModuleParamDef, getGraph: ReadGraph, getParam?: (name: string) => any): any {
		try {
			const variableName = singleVariableExpression.exec(expression)?.[1];
			// 現在のスコープにある値だけを直接取得する。0も有効で、prototype由来の名前は含めない。
			// PARAMはノードの式では関数で上書きされるため、同名のautomationGraphを直接返さない。
			if (variableName != null && Object.hasOwn(scope, variableName)
				&& !(variableName === 'PARAM' && getParam != null)
				&& !variableName.split(':').some(name => reservedWords.has(name))) {
				return scope[variableName];
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
			if (getParam != null) {
				const readParam = (args: (AiScript.values.Value | undefined)[]) => {
					if (args.length !== 1 || args[0]?.type !== 'str') throw new Error('PARAM requires a parameter name');
					return AiScript.utils.jsToVal(getParam(args[0].value));
				};
				constants.PARAM = AiScript.values.FN_NATIVE(readParam, readParam);
			}
			for (const key in constants) {
				if (this.aiscript.scope.exists(key)) {
					this.aiscript.scope.assign(key, constants[key]);
				} else {
					this.aiscript.scope.add(key, { isMutable: true, value: constants[key] });
				}
			}
			const cachedAst = this.astCache.get(expression);
			const ast = cachedAst ?? this.aisParser.parse(expression);
			if (cachedAst == null) this.astCache.set(expression, ast);
			const aisVal = this.aiscript.execSync(ast);
			return aisVal === undefined ? null : AiScript.utils.valToJs(aisVal);
		} catch {
			return genEmptyValue(paramDefForFallback);
		}
	}

	public evaluate(context: ParameterEvaluationContext): EvaluatedParameters {
		// GRAPHのtはグラフ自身のX座標（正規化なら0〜1、非正規化ならms）。
		// 特定の入力のdurationやoffsetには依存せず、名前を持つ参照グラフだけを公開する。
		const readGraph: ReadGraph = (name, t, wrapMode) => {
			const graph = context.automationGraphs.find(graph => graph.name === name);
			if (graph == null) throw new Error(`Unknown automation graph: ${name}`);
			return evalAutomationGraphValue(graph, t, wrapMode);
		};
		const paramValues = new Map<string, any>();
		const nodeParams = new Map<GsNode['id'], Record<string, any>>();
		const variablesScope = {
			WIDTH: context.resolution.width,
			HEIGHT: context.resolution.height,
			TIME: context.time / 1000, // ms to seconds
			TIME_MS: context.time,
			END_TIME: (context.endTime ?? Infinity) / 1000, // ms to seconds
			END_TIME_MS: (context.endTime ?? Infinity),
			PROGRESS: context.time / (context.endTime ?? Infinity),
			IS_EXPORT: context.isExport ?? false,
		} satisfies Record<typeof globalEnvVarDefs[number], any>;
		const getEnvironmentVariableValue = (variable: string) => {
			// 空の「None」や未知の保存済み値をprototype経由で読まず、既定値へフォールバックする。
			return Object.hasOwn(variablesScope, variable)
				? variablesScope[variable as keyof typeof variablesScope]
				: undefined;
		};

		for (const def of context.paramDefs) {
			const value = context.paramValues[def.id];
			if (context.inputParamIds.has(def.id)) continue;
			let evaluated = deepClone(def.defaultValue.value); // literalの中身を取り出し、参照が共有されないように切る
			if (value?.inputSource === 'literal') evaluated = value.value;
			if (value?.inputSource === 'envVariable') evaluated = getEnvironmentVariableValue(value.variable) ?? genEmptyValue(def);
			if (value?.inputSource === 'expression') evaluated = this.evaluateExpression(value.expression, variablesScope, def, readGraph);
			if (value?.inputSource === 'automationGraphReference') {
				const automationGraph = context.automationGraphs.find(automationGraph => automationGraph.id === value.automationGraphId);
				evaluated = automationGraph == null ? deepClone(def.defaultValue.value) : evaluateAutomationGraph(automationGraph, value, context);
			}
			if (value?.inputSource === 'automationGraphInline') evaluated = evaluateAutomationGraph(value.automationGraph, value, context);
			paramValues.set(def.id, evaluated);
		}

		const readParam = (name: string): any => {
			const def = context.paramDefs.find(def => def.name === name);
			if (def == null) throw new Error(`Unknown parameter: ${name}`);
			if (context.inputParamIds.has(def.id)) throw new Error(`Node input cannot be read by PARAM: ${name}`);
			return paramValues.get(def.id);
		};

		for (const node of context.nodes.filter((n): n is GsEffectNode => n.type === 'effect')) {
			const paramDefs = context.effectDefinitions[node.effectId].paramDefs;

			const evaluatedParams = {} as Record<string, any>;

			for (const [key, def] of Object.entries(paramDefs)) {
				if (node.isBypass && !def.primary) continue;
				evaluatedParams[key] = mapNodeParam(def, node.params[key], [key], (def, param) => {
					if (param.inputSource === 'literal') return param.value;
					if (param.inputSource === 'envVariable') return getEnvironmentVariableValue(param.variable) ?? genEmptyValue(def);
					if (param.inputSource === 'expression') return param.expression ? this.evaluateExpression(param.expression, variablesScope, def, readGraph, readParam) : genEmptyValue(def);
					if (param.inputSource === 'externalParameterInput') {
						if (!paramValues.has(param.parameterId) || context.inputParamIds.has(param.parameterId)) return genEmptyValue(def);
						return paramValues.get(param.parameterId);
					}
					if (param.inputSource === 'automationGraphReference') {
						const automationGraph = context.automationGraphs.find(a => a.id === param.automationGraphId);
						return automationGraph ? evaluateAutomationGraph(automationGraph, param, context) : genEmptyValue(def);
					}
					if (param.inputSource === 'automationGraphInline') return evaluateAutomationGraph(param.automationGraph, param, context);
					return param.nodeId == null ? null : { nodeId: param.nodeId, outputPort: param.outputPort };
				});
			}
			nodeParams.set(node.id, evaluatedParams);
		}
		return { paramValues, nodeParams };
	}
}
