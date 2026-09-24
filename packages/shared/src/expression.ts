export const moduleEnvVarDefs = ['WIDTH', 'HEIGHT', 'TIME', 'TIME_MS', 'END_TIME', 'END_TIME_MS', 'PROGRESS', 'IS_EXPORT', 'TEST_ONLY_VM', 'TEST_SAME_NAME'] as const;
export const layerEnvVarDefs = ['TEST_ONLY_LAYER', 'TEST_SAME_NAME', 'IS_EXPORT'] as const;
// 空文字列はUIの「None」を表す。評価時は定義にない変数として既定値へフォールバックする。
export type GlobalEnvVariable = typeof moduleEnvVarDefs[number] | typeof layerEnvVarDefs[number] | '';

// AiScript 1.2の識別子・予約語に合わせる。コメントやエスケープを含む式は通常のパーサーに任せる。

export const singleVariableExpression = /^[ \t\r\n]*([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*)[ \t\r\n]*$/;

export const reservedWords = new Set([
	'null', 'true', 'false', 'each', 'for', 'loop', 'do', 'while', 'break', 'continue',
	'match', 'case', 'default', 'if', 'elif', 'else', 'return', 'eval', 'var', 'let', 'exists',
	'as', 'async', 'attr', 'attribute', 'await', 'catch', 'class', 'component', 'constructor',
	'dictionary', 'enum', 'export', 'finally', 'fn', 'hash', 'in', 'interface', 'out',
	'private', 'public', 'ref', 'static', 'struct', 'table', 'this', 'throw', 'trait', 'try',
	'undefined', 'use', 'using', 'when', 'yield', 'import', 'is', 'meta', 'module', 'namespace', 'new',
]);
