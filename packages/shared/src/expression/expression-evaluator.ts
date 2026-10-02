import * as AiScript from '@syuilo/aiscript';
import { deepClone } from '../utility/deep-clone.ts';
import { RESERVED_EXPRESSION_WORDS, singleVariableExpression } from './expression-syntax.ts';
import type { ExpressionEnvironment } from './expression-environment.ts';

function expressionArgumentToJs(value: AiScript.values.Value | undefined): unknown {
	if (value === undefined) return undefined;
	// valToJsは関数を表示用の文字列にするため、名前を受け取る公開関数の引数には使えない。
	// 公開関数との境界ではデータだけを受け渡し、関数の暗黙の文字列化を防ぐ。
	switch (value.type) {
		case 'fn': throw new Error('Expression functions accept data arguments only');
		case 'arr': return value.value.map(expressionArgumentToJs);
		case 'obj': return Object.fromEntries([...value.value].map(([key, item]) => [key, expressionArgumentToJs(item)]));
		default: return AiScript.utils.valToJs(value);
	}
}

// 解析済みASTだけを再利用し、評価環境は式ごとに独立させる。
// GRAPHやPARAMの意味、利用できる変数・関数はこのエンジンでは決めない。
export class ExpressionEvaluator {
	private parser = new AiScript.Parser();
	private astCache = new Map<string, AiScript.Ast.Node[]>();

	evaluate(expression: string, environment: ExpressionEnvironment, fallback: any): any {
		try {
			const { variables, functions = {} } = environment;
			const variableName = singleVariableExpression.exec(expression)?.[1];
			// 現在のスコープの値だけを直接取得する。公開関数を変数で上書きしない。
			if (variableName != null && Object.hasOwn(variables, variableName) && !Object.hasOwn(functions, variableName)
				&& !variableName.split(':').some(name => RESERVED_EXPRESSION_WORDS.has(name))) {
				return deepClone(variables[variableName]);
			}
			const constants = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, AiScript.utils.jsToVal(value)]));
			for (const [name, fn] of Object.entries(functions)) {
				const invoke = (args: (AiScript.values.Value | undefined)[]) => AiScript.utils.jsToVal(
					fn(...args.map(expressionArgumentToJs)));
				constants[name] = AiScript.values.FN_NATIVE(invoke, invoke);
			}
			const interpreter = new AiScript.Interpreter(constants);
			const cachedAst = this.astCache.get(expression);
			const ast = cachedAst ?? this.parser.parse(expression);
			if (cachedAst == null) this.astCache.set(expression, ast);
			const value = interpreter.execSync(ast);
			return value === undefined ? null : AiScript.utils.valToJs(value);
		} catch {
			return fallback;
		}
	}
}
