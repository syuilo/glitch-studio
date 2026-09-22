import * as AiScript from '@syuilo/aiscript';
import { evalAutomationValue, genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { reservedWords, singleVariableExpression, type globalEnvVarDefs } from '@glitch/shared/expression.js';
import { mapNodeParam } from './utility/node-params.ts';
import type { EffectDefinition, EffectOptionSchema, VisualModuleParamDef } from '@glitch/shared/effect-definition.js';
import type { GsAutomation, GsEffectNode, GsNode, VisualModule, VisualModuleParamValues } from '@glitch/shared/types.ts';

export type ParameterEvaluationContext = {
	nodes: GsNode[];
	paramDefs: VisualModule['paramDefs'];
	effectDefinitions: Record<string, EffectDefinition>;
	automations: GsAutomation[];
	resolution: { width: number; height: number; };
	time: number;
	endTime: number; // 終了時刻という概念がないコンテキスト(例: live mode)の場合はInfinityとすること。
	paramValues: VisualModuleParamValues;
	// テクスチャそのものは扱わず、値として参照できないパラメータのIDだけを受け取る。
	textureParamIds: ReadonlySet<string>;
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

	// パフォーマンス上の理由でインタプリタは使いまわすが、毎回スコープは上書きしてるので特に問題ないはず
	// (本来ならスコープ的にアクセスできない値にアクセスできる可能性が生まれるのは許容する)
	private evaluateExpression(expression: string, scope: Record<string, any>, paramDefForFallback: EffectOptionSchema | VisualModuleParamDef, getParam?: (name: string) => any): any {
		try {
			const variableName = singleVariableExpression.exec(expression)?.[1];
			// 現在のスコープにある値だけを直接取得する。0も有効で、prototype由来の名前は含めない。
			// PARAMはノードの式では関数で上書きされるため、同名のautomationを直接返さない。
			if (variableName != null && Object.hasOwn(scope, variableName)
				&& !(variableName === 'PARAM' && getParam != null)
				&& !variableName.split(':').some(name => reservedWords.has(name))) {
				return scope[variableName];
			}
			const constants = Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, AiScript.utils.jsToVal(value)]));
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
			const aisVal = this.aiscript.execSync(this.aisParser.parse(expression));
			return aisVal === undefined ? null : AiScript.utils.valToJs(aisVal);
		} catch {
			return genEmptyValue(paramDefForFallback);
		}
	}

	public evaluate(context: ParameterEvaluationContext): EvaluatedParameters {
		const paramValues = new Map<string, any>();
		const nodeParams = new Map<GsNode['id'], Record<string, any>>();
		const scope = {
			WIDTH: context.resolution.width,
			HEIGHT: context.resolution.height,
			TIME: context.time / 1000, // ms to seconds
			TIME_MS: context.time,
			END_TIME: (context.endTime ?? Infinity) / 1000, // ms to seconds
			END_TIME_MS: (context.endTime ?? Infinity),
			PROGRESS: context.time / (context.endTime ?? Infinity),
			IS_EXPORT: false, // TODO
		} satisfies Record<typeof globalEnvVarDefs[number], any>;

		// Mixin (global) automations
		// TODO: 各automationをフレーム数を引数にとる関数として定義する
		const automationScope = {} as Record<string, any>;
		for (const automation of context.automations) {
			automationScope[automation.name] = evalAutomationValue(automation, context.time);
		}

		const mixedScope: Record<string, any> = { ...automationScope, ...scope };

		for (const def of context.paramDefs) {
			const value = context.paramValues[def.id];
			if (context.textureParamIds.has(def.id)) continue;
			let evaluated = deepClone(def.defaultValue.value); // literalの中身を取り出し、参照が共有されないように切る
			if (value?.inputSource === 'literal') evaluated = value.value;
			if (value?.inputSource === 'envVariable') evaluated = mixedScope[value.variable] ?? genEmptyValue(def);
			if (value?.inputSource === 'expression') evaluated = this.evaluateExpression(value.expression, mixedScope, def);
			if (value?.inputSource === 'automationReference') {
				const automation = context.automations.find(automation => automation.id === value.automationId);
				evaluated = automation == null ? deepClone(def.defaultValue.value) : evalAutomationValue(automation, context.time);
			}
			paramValues.set(def.id, evaluated);
		}

		const readParam = (name: string): any => {
			const def = context.paramDefs.find(def => def.name === name);
			if (def == null) throw new Error(`Unknown parameter: ${name}`);
			if (context.textureParamIds.has(def.id)) throw new Error(`Texture parameter cannot be read by PARAM: ${name}`);
			return paramValues.get(def.id);
		};

		for (const node of context.nodes.filter((n): n is GsEffectNode => n.type === 'effect')) {
			const paramDefs = context.effectDefinitions[node.effectId].paramDefs;

			const evaluatedParams = {} as Record<string, any>;

			for (const [key, def] of Object.entries(paramDefs)) {
				if (node.isBypass && !def.primary) continue;
				evaluatedParams[key] = mapNodeParam(def, node.params[key], [key], (def, param) => {
					if (param.inputSource === 'literal') return param.value;
					if (param.inputSource === 'envVariable') return mixedScope[param.variable] ?? genEmptyValue(def);
					if (param.inputSource === 'expression') return param.expression ? this.evaluateExpression(param.expression, mixedScope, def, readParam) : genEmptyValue(def);
					if (param.inputSource === 'externalParameterInput') {
						if (!paramValues.has(param.parameterId) || context.textureParamIds.has(param.parameterId)) return genEmptyValue(def);
						return paramValues.get(param.parameterId);
					}
					if (param.inputSource === 'automationReference') {
						const automation = context.automations.find(a => a.id === param.automationId);
						return automation ? evalAutomationValue(automation, context.time) : genEmptyValue(def);
					}
					return param.nodeId == null ? null : { nodeId: param.nodeId, outputPort: param.outputPort };
				});
			}
			nodeParams.set(node.id, evaluatedParams);
		}
		return { paramValues, nodeParams };
	}
}
