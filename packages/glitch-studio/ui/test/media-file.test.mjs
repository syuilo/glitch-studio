import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
	stdin: { contents: 'export { openMediaFile, selectMediaFiles } from \'./src/api.ts\'; export { encodeProjectFile, decodeProjectFile } from \'./src/gsproj.ts\';',
										resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	define: { _VERSION_: '"2.0.0-alpha"' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { openMediaFile, selectMediaFiles, encodeProjectFile, decodeProjectFile } = module.exports;

function setupMedia(t) {
	// このファイルは原本コピーの検証用で、動画のバイト列は実際のコンテナではない。
	// サムネイル生成の成功・失敗はvideo-thumbnails.test.mjsで別途検証する。
	t.mock.method(console, 'warn', () => {});
	const previous = ['window', 'HTMLVideoElement', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
	t.after(() => {
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});
	const decodedSources = [];
	const activeUrls = new Map();
	const input = new EventTarget();
	input.click = () => {};
	let closedBitmaps = 0;
	class Media {
		set src(url) {
			decodedSources.push(activeUrls.get(url));
			queueMicrotask(() => this.onloadedmetadata());
		}
		removeAttribute() {}
		load() {}
	}
	class Video extends Media { videoWidth = 4; videoHeight = 2; }
	globalThis.HTMLVideoElement = Video;
	globalThis.window = { document: { createElement(type) {
		if (type === 'video') return new Video();
		if (type === 'audio') return new Media();
		return input;
	} } };
	globalThis.createImageBitmap = async source => {
		decodedSources.push(source);
		return { width: 4, height: 2, close() { closedBitmaps++; } };
	};
	t.mock.method(URL, 'createObjectURL', blob => {
		const url = `blob:${activeUrls.size}`;
		activeUrls.set(url, blob);
		return url;
	});
	t.mock.method(URL, 'revokeObjectURL', url => activeUrls.delete(url));
	return { input, decodedSources, activeUrls, get closedBitmaps() { return closedBitmaps; } };
}

const mediaTypes = [
	{ name: 'image.png', type: 'image/png', width: 4, height: 2 },
	{ name: 'movie.mp4', type: 'video/mp4', width: 4, height: 2 },
	{ name: 'sound.wav', type: 'audio/wav', width: 0, height: 0 },
	{ name: 'font.ttf', type: '', expectedType: 'font/ttf', width: 0, height: 0 },
];

// 【LUTをOSのMIME判定によらず識別し、改名・保存後も原本と種類を保つ】
// .cubeが空MIMEやtext/plainでも選択候補に入り、表示名を変えても再判定で失われない。
// 不正な内容の検証は使用時に行うので、取り込みでは画像デコードしない。
test('imports cube assets with stable types and round trips their original contents', async t => {
	const { decodedSources } = setupMedia(t);
	for (const type of ['', 'text/plain', 'application/octet-stream']) {
		const text = 'TITLE "Example"\nLUT_1D_SIZE 2\n0 0 0\n1 1 1';
		const source = await openMediaFile({ file: new File([text], 'Example.CUBE', { type }), allowAnyFile: true });
		assert.equal(source.type, 'application/x-cube-lut');
		assert.equal(source.width, 0);
		assert.equal(source.height, 0);
		const encoded = await encodeProjectFile({ generatedSpeech: [], visualModules: [], timelineFps: 60,
																																												timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, timelineScenes: [],
																																												assets: [{ ...source, id: 'lut', name: 'Renamed', fileDataType: source.type }] });
		const restored = decodeProjectFile(encoded).assets[0];
		assert.equal(restored.name, 'Renamed');
		assert.equal(restored.fileDataType, 'application/x-cube-lut');
		assert.equal(await restored.fileData.text(), text);
	}
	assert.equal(decodedSources.length, 0);
});

// 【複数のFileから取り込むすべての素材に、それぞれの原本パスを記録する】
// フォントや音声だけメタデータが欠落したり、選択した先頭のパスを使い回したりしない。
// Blobへのコピー前のFileをデスクトップAPIへ渡し、プロジェクトの保存・再読込でもパスを保つ。
test('retains each source path when importing multiple desktop Files', async t => {
	setupMedia(t);
	const files = mediaTypes.map(media => new File([`encoded ${media.name}`], media.name, { type: media.type }));
	const paths = files.map(file => `C:\\素材 フォルダ\\${file.name}`);
	const requestedFiles = [];
	window.desktop = { getPathForFile(file) {
		requestedFiles.push(file);
		assert.ok(files.includes(file), 'The bridge must receive the original File');
		return paths[files.indexOf(file)];
	} };
	const imported = await openMediaFile({ files, multiple: true, includeFonts: true });
	assert.deepEqual(requestedFiles, files);
	assert.deepEqual(imported.map(source => source.sourceFilePath), paths);
	const encoded = await encodeProjectFile({ generatedSpeech: [], visualModules: [], timelineFps: 60,
																																											timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, timelineScenes: [],
																																											assets: imported.map((source, index) => ({ id: String(index), ...source, fileDataType: source.type })) });
	const restored = decodeProjectFile(encoded).assets;
	assert.deepEqual(restored.map(asset => asset.sourceFilePath), paths);
	for (let index = 0; index < files.length; index++) {
		assert.notEqual(imported[index].fileData, files[index]);
		assert.equal(await restored[index].fileData.text(), await files[index].text());
	}
});

// 【直接渡したFileからも原本パスを記録する】
// ドラッグ＆ドロップと画像・動画からの新規プロジェクト作成は、ファイル選択UIを経由しない。
// 選択ダイアログ側だけでパスを取得すると、これらの経路で記録が欠落する。
test('retains the desktop source path when a File is supplied directly', async t => {
	setupMedia(t);
	const file = new File(['encoded image'], 'image.png', { type: 'image/png' });
	const path = '/home/artist/素材/image.png';
	window.desktop = { getPathForFile(source) { assert.equal(source, file); return path; } };
	const imported = await openMediaFile({ file });
	assert.equal(imported.sourceFilePath, path);
	assert.equal(await imported.fileData.text(), 'encoded image');
});

for (const desktop of [false, true]) {
	// 【絶対パスを取得できない素材には推測したパスを保存しない】
	// ブラウザでは絶対パスが公開されず、ElectronでもJSで作ったFileには原本パスがない。
	// fakepath・相対パス・ファイル名を絶対パスとして記録せず、素材自体の取り込みは成功させる。
	test(`leaves unavailable source paths null ${desktop ? 'for generated desktop files' : 'in browsers'}`, async t => {
		const { input } = setupMedia(t);
		const file = new File(['encoded image'], 'image.png', { type: 'image/png' });
		Object.defineProperty(file, 'webkitRelativePath', { value: 'folder/image.png' });
		input.value = 'C:\\fakepath\\image.png';
		if (desktop) window.desktop = { getPathForFile: () => '' };
		const imported = await openMediaFile({ file });
		assert.equal(imported.sourceFilePath, null);
		assert.equal(await imported.fileData.text(), 'encoded image');
	});
}

for (const media of mediaTypes) {
	for (const change of ['overwrite', 'delete']) {
		// 【取り込んだ素材の原本を変更・削除しても、保存と再読込に元の内容を使える】
		// メモリ上のFileだけでは元ファイル変更による読取失敗を再現できない。
		// Nodeのディスク参照BlobをFile相当として渡し、実際に原本を変更して参照を無効にする。
		// 画像・動画・音声・フォントの全経路で、単なるsliceやBlobラップへの退行を検出する。
		test(`keeps imported ${media.name} readable after source ${change}`, async t => {
			const platform = setupMedia(t);
			const directory = await mkdtemp(join(tmpdir(), 'glitch-media-test-'));
			const path = join(directory, media.name);
			t.after(async () => { await rm(path, { force: true }); await rmdir(directory); });
			const original = 'original encoded media';
			await writeFile(path, original);
			const file = await openAsBlob(path, { type: media.type });
			Object.defineProperty(file, 'name', { value: media.name });
			const imported = await openMediaFile({ file, includeFonts: true });
			if (change === 'delete') await rm(path);
			else await writeFile(path, 'different source content with a different length');
			await assert.rejects(file.arrayBuffer());
			assert.equal(await imported.fileData.text(), original);
			assert.equal(imported.name, media.name);
			assert.equal(imported.type, media.expectedType ?? media.type);
			assert.equal(imported.fileData.type, imported.type);
			assert.equal(imported.width, media.width);
			assert.equal(imported.height, media.height);
			assert.equal(platform.decodedSources.length, media.expectedType ? 0 : 1);
			assert.ok(platform.decodedSources.every(source => source === imported.fileData));
			assert.equal(platform.activeUrls.size, 0);
			assert.equal(platform.closedBitmaps, media.type.startsWith('image/') ? 1 : 0);
			const encoded = await encodeProjectFile({ generatedSpeech: [], visualModules: [], timelineFps: 60,
																																													timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, timelineScenes: [],
																																													assets: [{ id: 'asset', ...imported, fileDataType: imported.type }] });
			assert.equal(await decodeProjectFile(encoded).assets[0].fileData.text(), original);
		});
	}
}

// 【読めない素材は取り込みを完了せず、ファイル名付きのエラーを返す】
// 保存時まで失敗を先送りせず、取り込み時点で問題のある原本を特定できるようにする。
test('rejects unreadable sources before decoding and identifies the file', async t => {
	const platform = setupMedia(t);
	const cause = new DOMException('Source changed', 'NotReadableError');
	const file = new File(['source'], 'missing.png', { type: 'image/png' });
	t.mock.method(file, 'arrayBuffer', async () => { throw cause; });
	await assert.rejects(openMediaFile({ file }), error => error.message.includes('missing.png') && error.cause === cause);
	assert.deepEqual(platform.decodedSources, []);
});

// 【任意のファイルをデコードせず取り込み、プロジェクト保存後もバイト列とMIMEを保持する】
// テキスト・アーカイブ・MIME不明のファイルを画像として扱うと取り込みに失敗する。
// フォントの正規化は維持し、ファイル選択にも種類の制限をかけない。
test('imports arbitrary files without decoding and retains their contents through project serialization', async t => {
	const platform = setupMedia(t);
	const files = [new File(['text'], 'notes.txt', { type: 'text/plain' }),
																new File([new Uint8Array([0, 255, 128])], 'archive.zip', { type: 'application/zip' }),
																new File(['unknown'], 'unknown'), new File(['font'], 'font.woff2')];
	const pending = openMediaFile({ multiple: true, allowAnyFile: true });
	assert.equal(platform.input.accept, '');
	platform.input.files = files;
	platform.input.onchange();
	const imported = await pending;
	const types = ['text/plain', 'application/zip', 'application/octet-stream', 'font/woff2'];
	assert.deepEqual(imported.map(source => source.type), types);
	assert.deepEqual(platform.decodedSources, []);
	assert.ok(imported.every(source => source.width === 0 && source.height === 0 && source.thumbnailSequence === null));
	const encoded = await encodeProjectFile({ generatedSpeech: [], visualModules: [], timelineFps: 60,
																																											timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, timelineScenes: [],
																																											assets: imported.map((source, index) => ({ id: String(index), ...source, fileDataType: source.type })) });
	const restored = decodeProjectFile(encoded).assets;
	assert.deepEqual(restored.map(asset => asset.fileDataType), types);
	for (let index = 0; index < files.length; index++) {
		assert.notEqual(imported[index].fileData, files[index]);
		assert.deepEqual(await restored[index].fileData.arrayBuffer(), await files[index].arrayBuffer());
	}
});

// 【メディア専用の入口は引き続き任意ファイルを拒否する】
// Open Mediaは素材に対応したプロジェクトを作るため、汎用ファイルを渡さない。
test('keeps media-only imports restricted when arbitrary file support is not requested', async t => {
	const platform = setupMedia(t);
	await assert.rejects(openMediaFile({ file: new File(['text'], 'notes.txt', { type: 'text/plain' }) }), /Unsupported media type/);
	assert.deepEqual(platform.decodedSources, []);
});

// 【外部参照は原本の全体読み込みを避け、実行時のURLとサイズだけを保持する】
// パスを取得できるElectronのファイルだけを対象にし、パスを持たない生成素材は従来どおりコピーする。
test('imports external references without reading the entire file and embeds pathless files', async t => {
	setupMedia(t);
	const file = new File(['encoded'], 'large.bin', { type: 'application/octet-stream' });
	t.mock.method(file, 'arrayBuffer', () => assert.fail('External imports must not read the entire source'));
	window.desktop = {
		getPathForFile: () => 'C:\\assets\\large.bin',
		resolveExternalAsset: async () => ({ url: 'app://external-assets/large', size: 1024 ** 4, error: null }),
	};
	const imported = await openMediaFile({ file, allowAnyFile: true, isExternalReference: true });
	assert.equal(imported.isExternalReference, true);
	assert.equal(imported.fileData.size, 1024 ** 4);
	assert.equal(imported.fileData.url, 'app://external-assets/large');
	window.desktop.getPathForFile = () => '';
	const generated = await openMediaFile({ file: new File(['generated'], 'generated.bin'), allowAnyFile: true, isExternalReference: true });
	assert.equal(generated.isExternalReference, false);
	assert.equal(await generated.fileData.text(), 'generated');
});

// 【Electronの素材選択は用途別のネイティブAPIを使い、取り込み前には原本を読まない】
// inputに戻るとディレクトリ記憶の分離が効かない。キャンセルと、ドラッグ＆ドロップ等で
// すでに渡されたFileはダイアログを追加せずそのまま扱うことも確認する。
test('uses native selection options without reading sources and bypasses dialogs for supplied files', async t => {
	const { input } = setupMedia(t);
	t.mock.method(input, 'click', () => assert.fail('Desktop selection must not use an HTML file input'));
	const selected = [{ kind: 'desktop-asset-file', path: 'C:\\assets\\image.png', name: 'image.png', type: 'image/png' }];
	const calls = [];
	window.desktop = {
		async chooseAssetFiles(options) { calls.push(options); return calls.length === 1 ? selected : null; },
		resolveExternalAsset() { assert.fail('Selection must not start importing'); },
	};
	assert.deepEqual(await selectMediaFiles({ multiple: true, includeFonts: true }), selected);
	assert.deepEqual(calls[0], { multiple: true, includeFonts: true, allowAnyFile: false });
	assert.equal(await openMediaFile({ allowAnyFile: true }), null);
	assert.deepEqual(calls[1], { multiple: false, includeFonts: false, allowAnyFile: true });
	const dropped = new File(['source'], 'dropped.png', { type: 'image/png' });
	assert.deepEqual(await selectMediaFiles({ files: [dropped] }), [dropped]);
	assert.deepEqual(await selectMediaFiles({ file: dropped }), [dropped]);
	assert.equal(calls.length, 2);
});

// 【ネイティブの複数選択でも各素材のパス・種類・原本コピーを保持する】
// Fileを経由しなくなったことでフォントや音声を失ったり、先頭のパスを全件に適用したり
// しない。埋め込みはURL参照を残さず、プロジェクト保存後も原本の内容を持つ。
test('imports and serializes each native selection with its own source path and contents', async t => {
	setupMedia(t);
	const selected = mediaTypes.map(media => ({ kind: 'desktop-asset-file', path: `C:\\素材\\${media.name}`, name: media.name, type: media.type }));
	window.desktop = {
		chooseAssetFiles: async () => selected,
		getPathForFile() { assert.fail('Native selections are not DOM Files'); },
		async resolveExternalAsset(filePath, reload) {
			assert.equal(reload, true);
			return { url: `app://external-assets/${selected.findIndex(file => file.path === filePath)}`, size: 20, error: null };
		},
	};
	t.mock.method(globalThis, 'fetch', async url => new Response(`original ${selected[Number(url.split('/').at(-1))].name}`));
	const imported = await openMediaFile({ multiple: true, includeFonts: true });
	assert.deepEqual(imported.map(file => file.sourceFilePath), selected.map(file => file.path));
	assert.deepEqual(imported.map(file => file.type), mediaTypes.map(media => media.expectedType ?? media.type));
	assert.ok(imported.every(file => file.isExternalReference === false && file.fileData instanceof Blob));
	const encoded = await encodeProjectFile({ generatedSpeech: [], visualModules: [], timelineFps: 60,
		timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, timelineScenes: [],
		assets: imported.map((source, index) => ({ id: String(index), ...source, fileDataType: source.type })) });
	const restored = decodeProjectFile(encoded).assets;
	for (const [index, file] of selected.entries()) {
		assert.equal(restored[index].sourceFilePath, file.path);
		assert.equal(await restored[index].fileData.text(), `original ${file.name}`);
	}
});

// 【ネイティブ素材もサイズで外部参照へ切り替え、一件の読取失敗で残りを失わない】
// 選択時に全量取得すると巨大ファイルでメモリを消費し、バッチ全体でstatすると
// 選択後に消えた一件のために他の素材まで取り込めなくなる。
test('checks native sizes before reading bytes and continues after an unreadable source', async t => {
	setupMedia(t);
	const selected = ['missing', 'large', 'small'].map(name => ({ kind: 'desktop-asset-file', path: `C:\\assets\\${name}.bin`, name: `${name}.bin`, type: '' }));
	const requests = [];
	window.desktop = {
		chooseAssetFiles: async () => selected,
		async resolveExternalAsset(filePath) {
			requests.push(filePath);
			const index = selected.findIndex(file => file.path === filePath);
			return index === 0 ? { url: null, size: 0, error: 'File removed' }
				: { url: `app://external-assets/${index}`, size: index === 1 ? 1024 ** 4 : 5, error: null };
		},
	};
	t.mock.method(globalThis, 'fetch', async url => {
		assert.equal(url, 'app://external-assets/2', 'Large sources must not be fetched in full');
		return new Response('small');
	});
	const errors = [];
	const progress = [];
	const imported = await openMediaFile({ multiple: true, allowAnyFile: true, externalReferenceThresholdBytes: 30_000_000,
		onFileError: (file, error) => errors.push({ name: file.name, error }), onReadProgress: value => progress.push(value) });
	assert.deepEqual(requests, selected.map(file => file.path));
	assert.equal(errors.length, 1);
	assert.equal(errors[0].name, 'missing.bin');
	assert.match(errors[0].error.message, /missing.bin/);
	assert.equal(imported[0].isExternalReference, true);
	assert.equal(imported[0].fileData.size, 1024 ** 4);
	assert.equal(imported[1].isExternalReference, false);
	assert.equal(await imported[1].fileData.text(), 'small');
	assert.equal(progress.at(-1).completedFiles, 3);
});
