import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { encode } from '@msgpack/msgpack';

async function loadSource(path) {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
		bundle: true, platform: 'node', format: 'cjs', write: false,
	});
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}

const { dragListen } = await loadSource('../src/utility/drag.ts');
const { loadProjectFile } = await loadSource('../src/api.ts');

// ドラッグを繰り返しても、終了した操作のリスナーや終了通知が残らない。
test('cleans up drag listeners after mouseup and mouseleave', t => {
	const target = new EventTarget();
	globalThis.window = target;
	t.after(() => { delete globalThis.window; });
	let moves = 0;
	let ends = 0;
	for (const endEvent of ['mouseup', 'mouseleave']) {
		dragListen(() => moves++, () => ends++);
		target.dispatchEvent(new Event('mousemove'));
		target.dispatchEvent(new Event(endEvent));
		target.dispatchEvent(new Event('mousemove'));
		target.dispatchEvent(new Event('mouseup'));
		target.dispatchEvent(new Event('mouseleave'));
	}
	assert.equal(moves, 2);
	assert.equal(ends, 2);
});

// 選択キャンセルは正常終了し、ファイルのバイナリをデコーダーへ渡す。
test('loads a MessagePack project and handles cancellation and invalid data', async t => {
	let input;
	t.after(() => { delete globalThis.window; });
	globalThis.window = { document: { createElement() {
		input = new EventTarget();
		input.click = () => {};
		return input;
	} } };
	const cancelled = loadProjectFile();
	input.dispatchEvent(new Event('cancel'));
	assert.equal(await cancelled, null);
	const project = { id: 'project', name: 'Test', visualModules: [], assets: [], players: [], timeline: [] };
	const loaded = loadProjectFile();
	input.files = [new File([encode(project)], 'test.gsproj')];
	input.dispatchEvent(new Event('change'));
	assert.deepEqual(await loaded, { project, name: 'test.gsproj' });
	const invalid = loadProjectFile();
	input.files = [new File([new Uint8Array([0xc1])], 'invalid.gsproj')];
	input.dispatchEvent(new Event('change'));
	await assert.rejects(invalid);
});
