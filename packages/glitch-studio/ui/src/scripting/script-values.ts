import { values } from '@syuilo/aiscript';
import type { values as AiScriptValues } from '@syuilo/aiscript';

export type ScriptData = null | boolean | number | string | ScriptData[] | { [key: string]: ScriptData };

/** 関数を表示用文字列へ変換してしまわないよう、ホストとの受け渡しはデータ値だけに限定する。 */
export function scriptValueToData(value: AiScriptValues.Value, ancestors = new Set<object>()): ScriptData {
	if (ancestors.has(value)) throw new Error('Cyclic values cannot be passed to project APIs');
	switch (value.type) {
		case 'null': return null;
		case 'bool': case 'num': case 'str': return value.value;
		case 'arr': case 'obj': {
			ancestors.add(value);
			try {
				return value.type === 'arr' ? value.value.map(item => scriptValueToData(item, ancestors))
					: Object.fromEntries([...value.value].map(([key, item]) => [key, scriptValueToData(item, ancestors)]));
			} finally { ancestors.delete(value); }
		}
		default: throw new Error('Project APIs accept only null, booleans, numbers, strings, arrays and objects');
	}
}

/** 毎回新しいAiScript値を作り、取得結果の変更がプロジェクトや履歴へ伝わることを防ぐ。 */
export function dataToScriptValue(data: unknown, ancestors = new Set<object>()): AiScriptValues.Value {
	if (data == null) return values.NULL;
	switch (typeof data) {
		case 'boolean': return values.BOOL(data);
		case 'number': return values.NUM(data);
		case 'string': return values.STR(data);
		case 'object': {
			if (ancestors.has(data)) throw new Error('Cyclic project data cannot be returned to scripts');
			if (!Array.isArray(data) && Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null) {
				throw new Error('Only plain project data can be returned to scripts');
			}
			ancestors.add(data);
			try {
				return Array.isArray(data) ? values.ARR(data.map(item => dataToScriptValue(item, ancestors)))
					: values.OBJ(new Map(Object.entries(data).map(([key, item]) => [key, dataToScriptValue(item, ancestors)])));
			} finally { ancestors.delete(data); }
		}
		default: throw new Error('Unsupported project data value');
	}
}

export function scriptObject(value: unknown): Record<string, ScriptData> {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an input object');
	return value as Record<string, ScriptData>;
}

/** 出力件数の制限だけでは巨大な配列の整形で停止するため、走査量と深さも制限する。 */
export function formatScriptOutput(value: AiScriptValues.Value, maxCharacters: number): string {
	let remaining = maxCharacters;
	const ancestors = new Set<object>();
	const chunks: string[] = [];
	const append = (text: string) => {
		chunks.push(text.slice(0, remaining));
		remaining = Math.max(0, remaining - text.length);
	};
	const visit = (item: AiScriptValues.Value, depth: number) => {
		if (remaining === 0) return;
		if (depth > 20) { append('…'); return; }
		if (ancestors.has(item)) { append('[Circular]'); return; }
		switch (item.type) {
			case 'null': append('null'); break;
			case 'num': case 'bool': append(String(item.value)); break;
			case 'str': append(depth === 0 ? item.value : JSON.stringify(item.value.slice(0, remaining))); break;
			case 'fn': append('<function>'); break;
			case 'error': append(`error(${item.value})`); break;
			case 'arr': case 'obj': {
				ancestors.add(item);
				append(item.type === 'arr' ? '[' : '{');
				let index = 0;
				for (const [key, child] of item.value.entries()) {
					if (remaining === 0) break;
					if (index++ > 0) append(', ');
					if (item.type === 'obj') append(`${JSON.stringify(String(key).slice(0, remaining))}: `);
					visit(child, depth + 1);
				}
				append(item.type === 'arr' ? ']' : '}');
				ancestors.delete(item);
				break;
			}
		}
	};
	visit(value, 0);
	return chunks.join('');
}
