import { values } from '@syuilo/aiscript';

// ホストとの境界で関数・循環参照を文字列へ暗黙変換しない。
// AiScriptの配列・オブジェクトは可変なので、受け渡しのたびに独立した値を作る。
export function scriptValueToData(value: values.Value, ancestors = new Set<values.Value>()): unknown {
	if (ancestors.has(value)) throw new Error('Cyclic values cannot be passed to the project API');
	if (ancestors.size > 100) throw new Error('Script data is nested too deeply');
	switch (value.type) {
		case 'null': return null;
		case 'str': case 'bool': return value.value;
		case 'num':
			if (!Number.isFinite(value.value)) throw new Error('Expected a finite number');
			return value.value;
		case 'arr': case 'obj': {
			ancestors.add(value);
			try {
				return value.type === 'arr' ? value.value.map(item => scriptValueToData(item, ancestors))
					: Object.fromEntries([...value.value].map(([key, item]) => [key, scriptValueToData(item, ancestors)]));
			} finally { ancestors.delete(value); }
		}
		default: throw new Error('Only data values can be passed to the project API');
	}
}

export function dataToScriptValue(value: unknown): values.Value {
	if (value == null) return values.NULL;
	if (typeof value === 'string') return values.STR(value);
	if (typeof value === 'number') return values.NUM(value);
	if (typeof value === 'boolean') return values.BOOL(value);
	if (Array.isArray(value)) return values.ARR(value.map(dataToScriptValue));
	if (typeof value === 'object') return values.OBJ(new Map(Object.entries(value).map(([key, item]) => [key, dataToScriptValue(item)])));
	throw new Error('Unsupported host value');
}

export function scriptString(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Expected a string');
	return value;
}

export function scriptBoolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Expected a boolean');
	return value;
}

export function scriptObject(value: unknown): Record<string, unknown> {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
	return value as Record<string, unknown>;
}

export function scriptKeys(value: Record<string, unknown>, keys: readonly string[]): void {
	for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error('Unknown field: ' + key);
}

export type ScriptApiFunction = { minimumArgs: number; maximumArgs: number; invoke: (...args: unknown[]) => unknown };
export function scriptFunction(minimumArgs: number, maximumArgs: number, invoke: ScriptApiFunction['invoke']): ScriptApiFunction {
	return { minimumArgs, maximumArgs, invoke };
}
