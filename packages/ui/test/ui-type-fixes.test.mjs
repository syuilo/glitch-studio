import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { encode, decode } from '@msgpack/msgpack';

async function loadSource(path) {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
		bundle: true, platform: 'node', format: 'cjs', write: false,
		define: { _VERSION_: '"2.0.0-alpha.2"' },
	});
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}

const { dragListen } = await loadSource('../src/utility/drag.ts');
const { openMediaFile } = await loadSource('../src/api.ts');
const { loadProjectFile, encodeProjectFile, decodeProjectFile } = await loadSource('../src/gsproj.ts');

// 取り込み時は寸法だけを取得し、デコード結果は閉じて元ファイルだけを保持する。
// 画素列をAssetへ残すと、状態の複製や保存のたびに原本とは別の大きなRGBA配列を持つことになる。
// デコードは入力検証と寸法取得のためだけに使い、画像リソースの寿命を取り込み処理内で閉じる。
test('imports image files without retaining decoded pixels', async t => {
	globalThis.window = { document: { createElement: () => new EventTarget() } };
	let closed = false;
	const file = new File(['encoded image'], 'image.png', { type: 'image/png' });
	globalThis.createImageBitmap = async source => {
		assert.equal(source, file);
		return { width: 4, height: 2, close() { closed = true; } };
	};
	t.after(() => { delete globalThis.window; delete globalThis.createImageBitmap; });
	const imported = await openMediaFile({ file });
	assert.deepEqual(imported, { width: 4, height: 2, name: file.name, type: file.type, fileData: file });
	assert.equal(closed, true);
	globalThis.createImageBitmap = async () => { throw new Error('invalid image'); };
	await assert.rejects(openMediaFile({ file }), /invalid image/);
});

// 画像・動画・音声・フォントの原本を復元でき、RGBAの画素列を保存しない。
// BlobはMessagePackへ直接保存できないため、保存時のバイト列化と読み込み時のBlob復元は必要。
// dataをなくしても原本のバイト列とMIME型を保ち、保存ファイルへデコード済み画素を再導入しない。
test('round trips original asset files without a decoded data field', async () => {
	const types = ['image/png', 'video/mp4', 'audio/wav', 'font/ttf'];
	const assets = types.map((type, index) => ({
		id: String(index), name: type, width: 4, height: 2,
		fileDataType: type, fileData: new Blob([new Uint8Array([index, 42, 255])], { type }),
	}));
	const encoded = await encodeProjectFile({ assets });
	const stored = decode(encoded);
	const restored = decodeProjectFile(encoded);
	for (let index = 0; index < assets.length; index++) {
		assert.equal('data' in stored.assets[index], false);
		assert.deepEqual(stored.assets[index].fileData, new Uint8Array([index, 42, 255]));
		assert.equal(restored.assets[index].fileData.type, types[index]);
		assert.deepEqual(new Uint8Array(await restored.assets[index].fileData.arrayBuffer()), stored.assets[index].fileData);
	}
});

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
	const project = { id: 'project', gsVersion: '2.0.0-alpha.2', name: 'Test', visualModules: [], assets: [], players: [], timeline: [] };
	const loaded = loadProjectFile();
	input.files = [new File([encode(project)], 'test.gsproj')];
	input.dispatchEvent(new Event('change'));
	assert.deepEqual(await loaded, { project, name: 'test.gsproj' });
	const invalid = loadProjectFile();
	input.files = [new File([new Uint8Array([0xc1])], 'invalid.gsproj')];
	input.dispatchEvent(new Event('change'));
	await assert.rejects(invalid);
});
