import type { Cloneable } from '../utility/deep-clone.ts';

// 利用可能な名前は呼び出し側のスコープが決める。空文字列はUIの未選択としても使う。
export type ExpressionVariableName = string;
export type ExpressionFunction = (...args: unknown[]) => unknown;

export type ExpressionEnvironment = {
	variables: Readonly<Record<ExpressionVariableName, Cloneable>>;
	functions?: Readonly<Record<string, ExpressionFunction>>;
};
