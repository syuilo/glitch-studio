import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserExportFile, getOpenExrFileName, selectOpenExrSaveTarget } from '../src/export/browser-export-file.ts';
import { createExportDirectory } from './helpers/export-directory.mjs';

// 【フォルダーと名前の選択だけではファイルを作成・切り詰めず、上書きを確認する】
// 長い描画の中断や保存先ダイアログの取り消しで、既存の出力を失わないための契約。
test('selects export names and confirms existing files without modifying them', async () => {
	const fresh = createExportDirectory();
	const selected = await selectOpenExrSaveTarget(fresh.directory, 'new', async () => { throw new Error('unexpected confirmation'); });
	assert.equal(selected.name, 'new.exr');
	assert.equal(selected.handle, null);
	assert.equal(fresh.exists, false);
	const existing = createExportDirectory(new Uint8Array([9]));
	assert.equal(await selectOpenExrSaveTarget(existing.directory, 'output.EXR', async name => { assert.equal(name, 'output.EXR'); return false; }), null);
	assert.deepEqual(existing.content, new Uint8Array([9]));
	for (const name of ['', '..', 'folder/output', 'folder\\output']) assert.throws(() => getOpenExrFileName(name));
});

// 【ヘッダーの後書きを反映し、完成した出力だけをcloseで公開する】
// 位置指定を単純な追記へ変換するとoffset tableが壊れ、EXRを読み込めなくなる。
test('writes patches at their original positions and commits only on finish', async () => {
	const f = createExportDirectory(new Uint8Array([9]));
	const target = await selectOpenExrSaveTarget(f.directory, 'output', async () => true);
	const writer = new BrowserExportFile(target);
	await writer.write(new Uint8Array([1, 2, 3, 4]), 0);
	await writer.write(new Uint8Array([7, 8]), 1);
	assert.deepEqual(f.content, new Uint8Array([9]));
	await writer.finish(4);
	await writer.abort();
	assert.deepEqual(f.content, new Uint8Array([1, 7, 8, 4]));
});

// 【保存待ち中の中断は一時出力を破棄し、新規作成した空の宛先も片付ける】
// 中断後に遅れて書き込みが完了しても、closeや既存ファイルの更新へ進ませない。
test('aborts pending writes and removes only newly created empty targets', async () => {
	for (const initial of [null, new Uint8Array([9])]) {
		const started = Promise.withResolvers(), release = Promise.withResolvers();
		const f = createExportDirectory(initial, async () => { started.resolve(); await release.promise; });
		const target = await selectOpenExrSaveTarget(f.directory, 'output', async () => true);
		const writer = new BrowserExportFile(target);
		const writing = writer.write(new Uint8Array([1, 2]), 0);
		await started.promise;
		const aborted = writer.abort();
		release.resolve();
		await Promise.all([writing, aborted]);
		assert.deepEqual(f.content, initial);
		assert.equal(f.events.some(([event]) => event === 'close'), false);
		await assert.rejects(writer.write(new Uint8Array([1]), 0), /not writable/);
	}
});

// 【選択後に同名ファイルが作られた場合や、出力に穴・長さの不一致がある場合は確定しない】
// 保存先の取り違えや不完全なWorker応答で、既存ファイルを無断で置換しない。
test('rejects stale targets and invalid output ranges', async () => {
	const f = createExportDirectory();
	const target = await selectOpenExrSaveTarget(f.directory, 'output', async () => true);
	await f.directory.getFileHandle('output.exr', { create: true });
	await assert.rejects(new BrowserExportFile(target).write(new Uint8Array([1]), 0), /another operation/);
	const writer = new BrowserExportFile({ directory: f.directory, handle: f.handle, name: 'output.exr' });
	await assert.rejects(writer.write(new Uint8Array([1]), 1), /position/);
	await writer.write(new Uint8Array([1]), 0);
	await assert.rejects(writer.finish(2), /incomplete/);
	await writer.abort();
	assert.deepEqual(f.content, new Uint8Array());
});
