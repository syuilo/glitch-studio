import type { ExpressionEnvironment } from './expression-environment.ts';

/** 評価器の利用側は構文解析器や言語実装を所有せず、必要な実装を呼び出し側から受け取る。 */
export interface ExpressionEngine {
	evaluate(expression: string, environment: ExpressionEnvironment): unknown;
}
