import * as AiScript from '@syuilo/aiscript';

const expressionParser = new AiScript.Parser();

/** 数値入力欄のドラフトを評価し、有限の数値として確定できない場合はnullを返す。 */
export function evaluateNumericInputExpression(draft: string | number | null): number | null {
	try {
		let numericValue: number;
		if (typeof draft === 'number') {
			// モデルやstepperから受け取った数値を式へ戻すと、指数表記などが構文に依存してしまう。
			numericValue = draft;
		} else {
			const ast = expressionParser.parse(draft ?? '');
			// 前回確定した式の変数や実行状態を引き継がず、入力欄内だけで評価を完結させる。
			const interpreter = new AiScript.Interpreter({});
			const result = interpreter.execSync(ast);
			// 文字列・真理値・nullなどを暗黙に数値へ変換しない。
			if (result == null || result.type !== 'num') return null;
			numericValue = result.value;
		}
		return Number.isFinite(numericValue) ? numericValue : null;
	} catch {
		// 構文・実行エラーでもドラフトを破棄せず、呼び出し側で修正や取消を受け付ける。
		return null;
	}
}
