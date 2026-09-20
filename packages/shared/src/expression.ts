export const globalEnvVarDefs = ['WIDTH', 'HEIGHT', 'TIME', 'TIME_MS', 'PROGRESS'];

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
