import type { values } from '@syuilo/aiscript';

/** 可変値の現在の内容を記録する。循環・巨大配列でも表示用の文字列を無制限に作らない。 */
export function formatScriptOutput(value: values.Value, limit = 4000): string {
	let text = '';
	let truncated = false;
	const ancestors = new Set<values.Value>();
	const append = (part: string) => {
		const available = limit - text.length;
		text += part.slice(0, available);
		if (part.length > available) truncated = true;
	};
	const visit = (item: values.Value, depth: number) => {
		if (text.length >= limit) { truncated = true; return; }
		if (ancestors.has(item)) { append('<circular>'); return; }
		if (depth > 20) { append('…'); return; }
		switch (item.type) {
			case 'null': append('null'); break;
			case 'str': append(depth === 0 ? item.value : JSON.stringify(item.value.slice(0, limit))); break;
			case 'num': case 'bool': append(String(item.value)); break;
			case 'fn': append('<function>'); break;
			case 'error': append('<error: ' + item.value + '>'); break;
			case 'arr': case 'obj': {
				ancestors.add(item);
				append(item.type === 'arr' ? '[' : '{');
				let index = 0;
				const entries = item.value.entries();
				for (const [key, child] of entries) {
					if (text.length >= limit) { truncated = true; break; }
					if (index++ > 0) append(', ');
					if (item.type === 'obj') append(String(key).slice(0, limit) + ': ');
					visit(child, depth + 1);
				}
				append(item.type === 'arr' ? ']' : '}');
				ancestors.delete(item);
				break;
			}
		}
	};
	visit(value, 0);
	return text + (truncated ? '…' : '');
}
