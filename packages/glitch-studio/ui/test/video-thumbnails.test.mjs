import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { decode } from '@msgpack/msgpack';

const bundle = await build({
	stdin: { contents: `export { generateVideoThumbnails } from './utility/video-thumbnails.ts';
		export { openMediaFile } from './api.ts';
		export { openMediaFile as openWithProgress } from './utility/open-media-file.ts';
		export { importAssets } from './utility/import-assets.ts';
		export { encodeProjectFile, decodeProjectFile } from './gsproj.ts';
		export { ProjectContext } from './Project.ts';
		export { getRendererAssets } from './utility/renderer-assets.ts';`,
		resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'],
	define: { _VERSION_: '"2.0.0-alpha"' },
	plugins: [{ name: 'thumbnail-test-dependencies', setup(build) {
		build.onResolve({ filter: /ui\.ts$/ }, () => ({ path: 'test-ui', external: true }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'test-preferences', external: true }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'test-effects', external: true }));
	} }],
});

function setup(t, overrides = {}) {
	const options = { start: 2, end: 12, width: 1920, height: 1080, ...overrides };
	const calls = { disposed: 0, encoded: [], timestamps: [], progress: [], subProgress: [], text: [], alerts: [], closedIterators: 0, dialogs: 0, done: 0 };
	const previousCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
	class Canvas {
		async convertToBlob() {
			const timestamp = this.timestamp;
			await Promise.resolve();
			assert.equal(this.timestamp, timestamp, 'A pooled canvas must not change while encoding');
			if (options.encodeFailure === true) throw new Error('Encoding failed');
			calls.encoded.push(timestamp);
			return new Blob([String(timestamp)], { type: options.mime ?? 'image/webp' });
		}
	}
	globalThis.OffscreenCanvas = Canvas;
	t.after(() => {
		if (previousCanvas != null) Object.defineProperty(globalThis, 'OffscreenCanvas', previousCanvas);
		else delete globalThis.OffscreenCanvas;
	});
	const track = {
		canDecode: async () => options.decodable !== false,
		getFirstTimestamp: async () => options.start, computeDuration: async () => options.end,
		getDisplayWidth: async () => options.width, getDisplayHeight: async () => options.height,
	};
	const mediabunny = { ALL_FORMATS: [], BlobSource: class { constructor(blob) { calls.blob = blob; } },
		Input: class { async getPrimaryVideoTrack() { return track; } dispose() { calls.disposed++; } },
		CanvasSink: class {
			constructor(received, settings) { assert.equal(received, track); calls.settings = settings; }
			async *canvasesAtTimestamps(timestamps) {
				calls.timestamps = timestamps;
				const canvas = new Canvas();
				try {
					for (const [index, requested] of timestamps.entries()) {
						canvas.timestamp = options.duplicate === true ? options.start : Math.min(requested, options.end - 0.05);
						yield options.nullFrame === index ? null : { canvas, timestamp: canvas.timestamp };
					}
				} finally { calls.closedIterators++; }
			}
		},
	};
	const require = createRequire(import.meta.url);
	const mocks = { mediabunny, 'test-preferences': { preferences: { s: { forceTypeSafety: false } } },
		'test-effects': { effectDefinitions: {} }, 'test-ui': { alert: async options => { calls.alerts.push(options); }, progress() {
			calls.dialogs++;
			return { setProgress: value => calls.progress.push(value), setSubProgress: value => calls.subProgress.push(value),
				setText: value => calls.text.push(value), done: () => { calls.done++; } };
		} } };
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => mocks[name] ?? require(name), module, module.exports);
	return { ...module.exports, calls, options };
}

// 【映像の有効範囲を11地点で抽出し、縮小・圧縮完了後にCanvasを再利用する】
// 先頭が0でない動画でも音声の範囲を混ぜず、100%は最後のフレームにする。
// 非同期圧縮中のCanvas再利用によって別の地点の画像を保存する不具合も検出する。
test('generates eleven scaled frames including the last frame with sequential encoding', async t => {
	const f = setup(t);
	const progress = [];
	const blob = new Blob(['video']);
	const sequence = await f.generateVideoThumbnails(blob, value => progress.push(value));
	assert.equal(f.calls.blob, blob);
	assert.deepEqual(f.calls.timestamps, Array.from({ length: 11 }, (_, index) => 2 + index));
	assert.deepEqual([sequence.width, sequence.height], [320, 180]);
	assert.equal(f.calls.settings.alpha, true);
	assert.equal(f.calls.settings.poolSize, 1);
	assert.equal(sequence.frames.length, 11);
	assert.equal(sequence.frames.at(-1).timestampSeconds, 11.95);
	assert.deepEqual(await Promise.all(sequence.frames.map(frame => frame.fileData.text())), f.calls.encoded.map(String));
	assert.deepEqual(progress, [0, ...Array.from({ length: 11 }, (_, index) => (index + 1) / 11)]);
	assert.equal(f.calls.disposed, 1);
	assert.equal(f.calls.closedIterators, 1);
});

// 【短い動画の重複フレームを省き、小さな動画は拡大しない】
// 11地点が同じ画像になる場合に保存容量を増やさず、縦動画にも長辺の上限を適用する。
test('deduplicates repeated timestamps and preserves small and portrait dimensions', async t => {
	const f = setup(t, { duplicate: true, width: 40, height: 80 });
	const sequence = await f.generateVideoThumbnails(new Blob());
	assert.deepEqual([sequence.width, sequence.height, sequence.frames.length], [40, 80, 1]);
	assert.equal(f.calls.encoded.length, 1);
	f.options.width = 1080;
	f.options.height = 1920;
	const portrait = await f.generateVideoThumbnails(new Blob());
	assert.deepEqual([portrait.width, portrait.height], [180, 320]);
});

// 【DOMのCanvasでも圧縮結果のMIMEを保ち、取得できない地点は省く】
// UI上のCanvasSinkはHTMLCanvasElementを返すため、Worker用のconvertToBlobだけでは動作しない。
// 動画の一部にフレームがなくても、残りのサムネイルと完了進捗を維持する。
test('encodes DOM canvases with their actual MIME and skips unavailable frames', async t => {
	const f = setup(t, { nullFrame: 3 });
	const original = OffscreenCanvas.prototype.convertToBlob;
	OffscreenCanvas.prototype.toBlob = function(callback) { void original.call(this).then(callback); };
	// instanceof判定だけをDOM経路へ切り替え、同じ非同期エンコードのfixtureを利用する。
	globalThis.OffscreenCanvas = class {};
	f.options.mime = 'image/png';
	const progress = [];
	const sequence = await f.generateVideoThumbnails(new Blob(), value => progress.push(value));
	assert.equal(sequence.frames.length, 10);
	assert.ok(sequence.frames.every(frame => frame.fileData.type === 'image/png'));
	assert.equal(sequence.frames.some(frame => frame.timestampSeconds === 5), false);
	assert.equal(progress.at(-1), 1);
});

// 【生成失敗時にもデコーダーと反復処理を閉じる】
// エンコード失敗や無効な素材の後に資源を残すと、次の素材取り込みが不安定になる。
test('disposes inputs and closes iteration after encoding and metadata failures', async t => {
	const f = setup(t, { encodeFailure: true });
	await assert.rejects(f.generateVideoThumbnails(new Blob()), /Encoding failed/);
	assert.equal(f.calls.closedIterators, 1);
	assert.equal(f.calls.disposed, 1);
	f.options.end = f.options.start;
	await assert.rejects(f.generateVideoThumbnails(new Blob()), /invalid range/);
	assert.equal(f.calls.disposed, 2);
});

// 【サムネイル列の画像バイト列・実際のMIME・時刻をプロジェクト保存で維持する】
// CanvasがWebP要求に対してPNGを返しても、保存後に誤った形式として復元しない。
// 原本と表示用画像を区別し、レンダラーへ表示用Blobを渡さない。
test('round trips thumbnail bytes timestamps and actual MIME without leaking them to renderers', async t => {
	const f = setup(t, { mime: 'image/png' });
	const thumbnailSequence = await f.generateVideoThumbnails(new Blob());
	const asset = { id: 'video', name: 'movie', width: 1920, height: 1080, fileDataType: 'video/mp4',
		fileData: new Blob(['original video'], { type: 'video/mp4' }), sourceFilePath: 'C:/movie.mp4', thumbnailSequence };
	const encoded = await f.encodeProjectFile({ gsVersion: '2.0.0-alpha', assets: [asset], generatedSpeech: [], timelineScenes: [] });
	const stored = decode(encoded).assets[0];
	assert.ok(stored.thumbnailSequence.frames.every(frame => frame.fileData instanceof Uint8Array));
	const restored = f.decodeProjectFile(encoded).assets[0];
	assert.equal(await restored.fileData.text(), 'original video');
	assert.deepEqual([restored.thumbnailSequence.width, restored.thumbnailSequence.height], [320, 180]);
	for (const [index, frame] of restored.thumbnailSequence.frames.entries()) {
		assert.equal(frame.timestampSeconds, thumbnailSequence.frames[index].timestampSeconds);
		assert.equal(frame.fileData.type, 'image/png');
		assert.equal(await frame.fileData.text(), await thumbnailSequence.frames[index].fileData.text());
	}
	assert.equal('thumbnailSequence' in f.getRendererAssets([asset])[0], false);
	assert.equal('sourceFilePath' in f.getRendererAssets([asset])[0], false);
});

// 【素材の追加・差し替えをUndo/Redoしても原本とサムネイル列が一致する】
// 映像から音声への差し替えで古いサムネイルを残さず、Undoは原本パス・寸法もまとめて復元する。
test('keeps thumbnail sequences with their source through add replace undo and redo', async t => {
	const f = setup(t);
	t.mock.method(console, 'log', () => {});
	const manager = new f.ProjectContext().stateManager;
	const original = { id: 'video', name: 'movie', width: 320, height: 180, fileDataType: 'video/mp4',
		fileData: new Blob(['video']), sourceFilePath: 'C:/movie.mp4', thumbnailSequence: await f.generateVideoThumbnails(new Blob()) };
	manager.commit('addAsset', original);
	assert.equal(manager.state.assets.value[0].thumbnailSequence.frames.length, 11);
	manager.undo();
	assert.equal(manager.state.assets.value.length, 0);
	manager.redo();
	manager.commit('replaceAsset', { ...original, assetId: original.id, width: 0, height: 0,
		fileDataType: 'audio/wav', fileData: new Blob(['audio']), sourceFilePath: null, thumbnailSequence: null });
	assert.equal(manager.state.assets.value[0].thumbnailSequence, null);
	manager.undo();
	assert.equal(manager.state.assets.value[0].fileData, original.fileData);
	assert.equal(manager.state.assets.value[0].sourceFilePath, original.sourceFilePath);
	assert.equal(manager.state.assets.value[0].thumbnailSequence.frames.length, 11);
	manager.redo();
	assert.equal(manager.state.assets.value[0].thumbnailSequence, null);
	assert.equal(await manager.state.assets.value[0].fileData.text(), 'audio');
	// 保存ファイルの素材は任意フィールドhashを持たない場合もある。
	delete manager.state.assets.value[0].hash;
	manager.commit('replaceAsset', { ...original, assetId: original.id, hash: 'replacement' });
	manager.undo();
	assert.equal(manager.state.assets.value[0].hash, undefined);
});

function setupImport(t) {
	const previous = ['window', 'HTMLVideoElement', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
	t.after(() => {
		for (const [key, descriptor] of previous) {
			if (descriptor != null) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});
	class Video {
		videoWidth = 1920;
		videoHeight = 1080;
		set src(_url) { queueMicrotask(() => this.onloadedmetadata()); }
		removeAttribute() {}
		load() {}
	}
	globalThis.HTMLVideoElement = Video;
	const input = new EventTarget();
	input.click = () => {};
	globalThis.window = { document: { createElement: type => type === 'video' ? new Video() : input } };
	return input;
}

// 【複数動画のサムネイル生成を待ち、進捗ダイアログを一度だけ表示する】
// 取り込み完了時に表示用画像が揃っていることと、ファイルごとに進捗率が巻き戻らないことを確認する。
test('waits for multiple video sequences and closes a single progress dialog', async t => {
	const f = setup(t);
	const input = setupImport(t);
	const pending = f.openWithProgress({ multiple: true });
	input.files = [new File(['a'], 'a.mp4', { type: 'video/mp4' }), new File(['b'], 'b.mp4', { type: 'video/mp4' })];
	input.onchange();
	const assets = await pending;
	assert.ok(assets.every(asset => asset.thumbnailSequence.frames.length === 11));
	assert.equal(f.calls.dialogs, 1);
	assert.equal(f.calls.done, 1);
	assert.equal(f.calls.progress[0], 0);
	assert.equal(f.calls.progress.at(-1), 1);
	assert.ok(f.calls.progress.every((value, index, values) => index === 0 || value >= values[index - 1]));
	assert.equal(f.calls.subProgress[0], null);
	assert.equal(f.calls.subProgress.at(-1), 1);
	assert.ok(f.calls.subProgress.includes(1 / 11));
	assert.ok(f.calls.text.includes('Reading: a.mp4 (1/2)'));
	assert.ok(f.calls.text.includes('Generating thumbnails: b.mp4 (2/2)'));
});

// 【原本を読む前から待機ダイアログを表示し、単一ファイルはメイン進捗だけを使う】
// サムネイル開始前や画像だけの取り込みにも操作ロックを適用する。
// 計測できないファイル読み込みを0%と見せず、nullの待機状態で表現する。
test('opens progress before reading source bytes and uses only main progress for one file', async t => {
	const f = setup(t);
	setupImport(t);
	const gate = Promise.withResolvers();
	const file = new File(['video'], 'movie.mp4', { type: 'video/mp4' });
	Object.defineProperty(file, 'arrayBuffer', { value: async () => {
		assert.equal(f.calls.dialogs, 1);
		assert.equal(f.calls.progress.at(-1), null);
		await gate.promise;
		return new TextEncoder().encode('video').buffer;
	} });
	const pending = f.openWithProgress({ file });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.calls.done, 0);
	gate.resolve();
	await pending;
	assert.equal(f.calls.subProgress.length, 0);
	assert.equal(f.calls.progress.at(-1), 1);
	assert.equal(f.calls.done, 1);
});

// 【対応素材だけを直列で読み込み、一括反映まで操作ロックを維持する】
// 不正なファイルが途中にあっても残りを取り込み、サムネイル・原本パスを保つ。
// AssetとPlayerを一度のUndoで除去し、失敗内容はダイアログを閉じてからまとめて通知する。
test('imports valid files in order with one undo and reports failures after closing progress', async t => {
	const f = setup(t);
	setupImport(t);
	t.mock.method(console, 'log', () => {});
	globalThis.createImageBitmap = async () => ({ width: 2, height: 1, close() {} });
	const context = new f.ProjectContext();
	const files = [new File(['video'], 'movie.mp4', { type: 'video/mp4' }), new File(['bad'], 'bad.bin'),
		new File(['image'], 'image.png', { type: 'image/png' }), new File(['font'], 'font.ttf')];
	let prepared = false;
	const stop = context.stateManager.onChange(() => { assert.equal(f.calls.done, 0); });
	const ids = await f.importAssets(context, files, async () => {
		assert.equal(f.calls.done, 0);
		prepared = true;
	});
	assert.equal(prepared, true);
	assert.equal(ids.length, 3);
	assert.deepEqual(context.stateManager.state.assets.value.map(asset => asset.name), ['movie.mp4', 'image.png', 'font.ttf']);
	assert.equal(context.stateManager.state.players.value.length, 1);
	assert.equal(context.stateManager.undoStack.value.length, 1);
	assert.equal(f.calls.done, 1);
	assert.equal(f.calls.alerts.length, 1);
	assert.match(f.calls.alerts[0].text, /bad.bin/);
	stop();
	context.stateManager.undo();
	assert.equal(context.stateManager.state.assets.value.length, 0);
	assert.equal(context.stateManager.state.players.value.length, 0);
	context.stateManager.redo();
	assert.equal(context.stateManager.state.assets.value[0].thumbnailSequence.frames.length, 11);
	assert.equal(context.stateManager.state.players.value[0].assetId, ids[0]);
});

// 【すべてのファイルが未対応の場合はプロジェクトとUndo履歴を作らない】
// Dashboardへ誤ったファイルをドロップしても、空のプロジェクトで画面を閉じない。
test('does not prepare a project or commit history when every file fails', async t => {
	const f = setup(t);
	setupImport(t);
	const context = new f.ProjectContext();
	const ids = await f.importAssets(context, [new File(['bad'], 'bad.bin')], async () => assert.fail('No project should be created'));
	assert.deepEqual(ids, []);
	assert.equal(context.hasProject, false);
	assert.equal(context.stateManager.undoStack.value.length, 0);
	assert.equal(f.calls.done, 1);
	assert.equal(f.calls.alerts.length, 1);
});

// 【サムネイル失敗では素材を取り込み、後続素材の失敗でも進捗ダイアログを閉じる】
// WebCodecsで扱えない動画を拒否せず、非同期エラーの後に操作不能な画面を残さない。
test('imports undecodable thumbnail sources and closes progress on later import failure', async t => {
	const f = setup(t, { decodable: false });
	const input = setupImport(t);
	t.mock.method(console, 'warn', () => {});
	const asset = await f.openWithProgress({ file: new File(['video'], 'movie.mp4', { type: 'video/mp4' }) });
	assert.equal(asset.thumbnailSequence, null);
	assert.equal(await asset.fileData.text(), 'video');
	assert.equal(f.calls.done, 1);
	f.options.decodable = true;
	globalThis.createImageBitmap = async () => { throw new Error('Invalid image'); };
	const pending = f.openWithProgress({ multiple: true });
	input.files = [new File(['video'], 'movie.mp4', { type: 'video/mp4' }), new File(['bad'], 'bad.png', { type: 'image/png' })];
	input.onchange();
	await assert.rejects(pending, /Invalid image/);
	assert.equal(f.calls.done, 2);
});
