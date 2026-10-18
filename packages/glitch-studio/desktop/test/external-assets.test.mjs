import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ExternalAssetFiles, projectAssetPath, registerExternalAssetIpc } from '../external-assets.mjs';

async function fixture(t) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-external-assets-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const filePath = path.join(directory, 'original.bin');
	await fs.writeFile(filePath, Uint8Array.from({ length: 1024 }, (_, index) => index % 256));
	const files = new ExternalAssetFiles();
	return { directory, filePath, files };
}

// 【原本の必要範囲だけを配信し、シーク・末尾読み出し・不正な範囲を区別する】
// 全体をreadFileしてから切り出す経路へ戻さず、レスポンスの長さと実データを一致させる。
test('streams requested byte ranges and handles suffixes and invalid requests', async t => {
	const { filePath, files } = await fixture(t);
	const source = await files.resolve(filePath);
	assert.equal(source.size, 1024);
	assert.equal(source.error, null);
	for (const [range, expectedStart, length] of [['bytes=100-109', 100, 10], ['bytes=-3', 1021, 3], ['bytes=1020-', 1020, 4]]) {
		const response = await files.respond(new Request(source.url, { headers: { Range: range } }), 'app://glitch-studio');
		assert.equal(response.status, 206);
		assert.equal(response.headers.get('Content-Length'), String(length));
		assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'app://glitch-studio');
		assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.from({ length }, (_, index) => (expectedStart + index) % 256));
	}
	const invalid = await files.respond(new Request(source.url, { headers: { Range: 'bytes=1024-' } }), 'app://glitch-studio');
	assert.equal(invalid.status, 416);
	assert.equal(invalid.headers.get('Content-Range'), 'bytes */1024');
	assert.equal((await files.respond(new Request('app://external-assets/not-registered'), 'app://glitch-studio')).status, 404);
	const head = await files.respond(new Request(source.url, { method: 'HEAD' }), 'app://glitch-studio');
	assert.equal(head.headers.get('Content-Length'), '1024');
	assert.equal((await head.arrayBuffer()).byteLength, 0);
});

// 【再確認でURLを変えず、明示リロードだけでキャッシュを無効化する】
// フォーカス復帰を自動リロードにせず、削除時もプロジェクトを開ける失敗情報を返す。
test('keeps a stable source until reload and reports inaccessible files without throwing', async t => {
	const { filePath, files } = await fixture(t);
	const first = await files.resolve(filePath);
	assert.equal((await files.resolve(filePath)).url, first.url);
	assert.notEqual((await files.resolve(filePath, true)).url, first.url);
	await fs.unlink(filePath);
	assert.equal((await files.resolve(filePath)).url, null);
	assert.match((await files.resolve(filePath)).error, /original.bin/);
	assert.equal((await files.respond(new Request(first.url), 'app://glitch-studio')).status, 404);
});

// 【保存先配下だけ相対化し、兄弟フォルダー・親・別ドライブの参照を保つ】
// 単純な文字列の前方一致ではproject-otherを子と誤認し、別名保存で参照先が変わってしまう。
test('stores only descendant paths relatively and rebases against each save destination', () => {
	const directory = path.resolve('project');
	const project = path.join(directory, 'work.gsproj');
	const asset = path.join(directory, 'assets', 'video.mp4');
	assert.equal(projectAssetPath(asset, project, true), 'assets/video.mp4');
	assert.equal(projectAssetPath('assets/video.mp4', project, false), asset);
	for (const outside of [path.resolve('video.mp4'), path.resolve('project-other', 'video.mp4')]) assert.equal(projectAssetPath(outside, project, true), outside);
	assert.equal(projectAssetPath(asset, path.resolve('elsewhere', 'copy.gsproj'), true), asset);
	if (process.platform === 'win32') assert.equal(projectAssetPath('Z:\\video.mp4', project, true), 'Z:\\video.mp4');
});

// 【原本書き出しは完成後だけ公開し、キャンセルでは旧ファイルを維持する】
// 保存先を選んだだけでファイルを変更せず、チャンク送信の失敗で半端な原本を残さない。
test('exports original bytes through bounded chunks and aborts without replacing the destination', async t => {
	const { directory, filePath, files } = await fixture(t);
	const handlers = new Map();
	const trusted = {};
	const destination = path.join(directory, 'export.bin');
	await fs.writeFile(destination, 'previous');
	registerExternalAssetIpc({ handle: (name, action) => handlers.set(name, action) }, {
		showSaveDialog: async () => ({ filePath: destination }), showOpenDialog: async () => ({ filePaths: [filePath] }),
	}, files, { getPath: () => path.join(directory, 'work.gsproj') }, event => { if (event !== trusted) throw new Error('Untrusted'); return {}; });
	const invoke = (name, ...args) => handlers.get(`desktop:${name}`)(trusted, ...args);
	let id = await invoke('begin-asset-export', 'original.bin');
	await invoke('write-asset-export', id, new Uint8Array([1, 2]));
	assert.equal(await fs.readFile(destination, 'utf8'), 'previous');
	await invoke('abort-asset-export', id);
	assert.equal(await fs.readFile(destination, 'utf8'), 'previous');
	id = await invoke('begin-asset-export', 'original.bin');
	await invoke('write-asset-export', id, new Uint8Array([1, 2]));
	await invoke('write-asset-export', id, new Uint8Array([3]));
	await invoke('write-asset-export', id, null);
	assert.deepEqual(new Uint8Array(await fs.readFile(destination)), new Uint8Array([1, 2, 3]));
	for (const handler of handlers.values()) await assert.rejects(async () => handler({}), /Untrusted/);
});
