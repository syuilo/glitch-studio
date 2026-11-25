import { evaluateCurveAnimation } from '../curve-animation/curve-animation-evaluator.ts';
import { evaluateFunctionCurve } from '../function-curve/function-curve-evaluator.ts';
import type { ExpressionEngine } from '../expression/expression-engine.ts';
import { randomExpressionFunctions } from '../expression/random-functions.ts';
import { evaluateKeyframesTimeline } from '../keyframes/keyframes-timeline-evaluator.ts';
import { deepClone } from '../utility/deep-clone.ts';
import type { Cloneable } from '../utility/deep-clone.ts';
import { coerceParameterValue } from './coerce-parameter-value.ts';
import type { ParameterDefinition } from './parameter-definition.ts';
import type { ExpressionFunction } from '../expression/expression-environment.ts';
import type { ValueParameterBinding } from './value-parameter-binding.ts';
import type { ParameterEvaluationScope } from './parameter-evaluation-scope.ts';

type EvaluationParameterDefinition = Pick<ParameterDefinition, 'dataType' | 'ui'>;

// Evaluatorはstateless/deterministicである必要がある

// 評価結果やスコープは保持せず、同じBindingとスコープから同じ値を返す。
export class ParameterBindingEvaluator {
	private readonly expressionEvaluator: ExpressionEngine | null;

	constructor(expressionEvaluator: ExpressionEngine | null) { this.expressionEvaluator = expressionEvaluator; }

	private functionCurveReader(scope: ParameterEvaluationScope): ExpressionFunction {
		return (...args) => {
			const [nameForReference, coordinate, wrapMode] = args;
			if (args.length !== 3 || typeof nameForReference !== 'string' || typeof coordinate !== 'number' || !Number.isFinite(coordinate)
				|| (wrapMode !== 'clamp' && wrapMode !== 'repeat' && wrapMode !== 'repeatMirrored')) {
				throw new Error('FUNCTION_CURVE requires a nameForReference, finite coordinate and wrap mode');
			}
			const functionCurve = scope.functionCurves.find(candidate => candidate.nameForReference === nameForReference);
			if (functionCurve == null) throw new Error(`Unknown Function Curve nameForReference: ${nameForReference}`);
			return evaluateFunctionCurve(functionCurve, coordinate, wrapMode);
		};
	}

	public evaluate(binding: ValueParameterBinding, scope: ParameterEvaluationScope, fallback: any, definition: EvaluationParameterDefinition): any {
		return this.bind(binding, fallback, definition, scope.functionCurves)(scope);
	}

	/** 入力方式と参照先が固定の配置では、評価経路を配置の生成時に選ぶ。時刻と値は描画ごとに読む。 */
	public bind(binding: ValueParameterBinding, fallback: any, definition: EvaluationParameterDefinition,
		functionCurves: ParameterEvaluationScope['functionCurves']): (scope: ParameterEvaluationScope) => unknown {
		const read = this.bindSource(binding, fallback, definition, functionCurves);
		const modifier = binding.expressionModifier;
		if (modifier?.enabled !== true) return read;
		return scope => {
			const base = read(scope);
				// 数値文字列の変換だけを行い、式が返す型・構造の正しさは検査しない。
			try {
				return this.evaluateExpression(modifier.code, scope, 'modifier', definition, coerceParameterValue(definition, base));
			} catch (error) {
				if (error instanceof ParameterExpressionError) throw error;
				throw new ParameterExpressionError('modifier', definition, error);
			}
		};
	}

	private evaluateExpression(code: string, scope: ParameterEvaluationScope, stage: 'base' | 'modifier', definition: EvaluationParameterDefinition, value?: unknown): any {
		try {
			if (this.expressionEvaluator == null) throw new Error('Expression evaluation is unavailable');
			const variables = { ...scope.variables };
			const functions = {
				...scope.functions,
				...randomExpressionFunctions,
				FUNCTION_CURVE: this.functionCurveReader(scope),
			};
			// VALUEは加工式だけに公開する。親スコープの同名変数・関数を基準式へ漏らさない。
			delete variables.VALUE;
			delete (functions as Record<string, ExpressionFunction>).VALUE;
			// 式エンジンが変数を複製するため、保存値を保護するコピーはそこで一度だけ行う。
			if (stage === 'modifier') variables.VALUE = value as Cloneable;
			const result = this.expressionEvaluator.evaluate(code, { variables, functions });
			return coerceParameterValue(definition, result);
		} catch (error) {
			throw new ParameterExpressionError(stage, definition, error);
		}
	}

	private bindSource(binding: ValueParameterBinding, fallback: any, definition: EvaluationParameterDefinition,
		functionCurves: ParameterEvaluationScope['functionCurves']): (scope: ParameterEvaluationScope) => unknown {
		switch (binding.inputSource) {
			case 'literal': return () => binding.value;
			case 'envVariable': return scope => Object.hasOwn(scope.variables, binding.variable) ? deepClone(scope.variables[binding.variable]) ?? fallback : fallback;
			case 'expression': return scope => this.evaluateExpression(binding.expression, scope, 'base', definition);
			case 'curveAnimationInline': {
				const { curveAnimation } = binding;
				const curveBinding = curveAnimation.curveBinding;
				const curve = curveBinding.source === 'inline' ? curveBinding.curve : functionCurves.find(candidate => candidate.id === curveBinding.curveId);
				return curve == null ? () => fallback : scope => evaluateCurveAnimation(curveAnimation, curve, scope.time, scope.endTime);
			}
			case 'keyframesTimelineInline': return scope => evaluateKeyframesTimeline(binding.keyframesTimeline, binding, scope.time, scope.endTime, fallback);
			default: throw new Error('Unsupported value parameter input source');
		}
	}
}

// エンジンはScene・ノード・レイヤーを知らない。ここでは式の段階とパラメータ名だけを付加し、
// 上位のレンダラーが持つ所在情報と組み合わせて、通常のレンダリング失敗として通知する。
class ParameterExpressionError extends Error {
	constructor(stage: 'base' | 'modifier', definition: EvaluationParameterDefinition, cause: unknown) {
		super(`${stage === 'base' ? 'Base' : 'Modifier'} expression for parameter ${JSON.stringify(definition.ui.label)}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
	}
}
