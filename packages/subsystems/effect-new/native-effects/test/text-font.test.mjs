import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTextFont } from '../src/text-font.ts';

// 【古い配置の読み込みが遅れても新しいフォント登録を上書きしない】
// FontFace.loadは中断後も完了し得るため、完了順を逆転させて登録と解放の対象を確認する。
test('discards a cancelled font load after the replacement font is registered', async t => {
	const fonts = new Set();
	const loads = [Promise.withResolvers(), Promise.withResolvers()];
	const starts = [Promise.withResolvers(), Promise.withResolvers()];
	let index = 0;
	const replacements = { fonts, FontFace: class {
		constructor(family) { this.family = family; }
		load() { const i = index++; starts[i].resolve(this); return loads[i].promise; }
	} };
	for (const [key, value] of Object.entries(replacements)) {
		const original = Object.getOwnPropertyDescriptor(globalThis, key);
		t.after(() => { if (original == null) delete globalThis[key]; else Object.defineProperty(globalThis, key, original); });
		Object.defineProperty(globalThis, key, { configurable: true, value });
	}
	const cancelled = new AbortController();
	const obsolete = assert.rejects(loadTextFont(new Blob(['first']), cancelled.signal), { name: 'AbortError' });
	const first = await starts[0].promise;
	cancelled.abort();
	const replacement = loadTextFont(new Blob(['second']));
	const second = await starts[1].promise;
	loads[1].resolve(second);
	const registered = await replacement;
	loads[0].resolve(first);
	await obsolete;
	assert.deepEqual([...fonts], [second]);
	assert.equal(registered.family, second.family);
	registered.dispose();
	assert.equal(fonts.size, 0);
});
