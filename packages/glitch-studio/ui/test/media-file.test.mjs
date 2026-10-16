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
	stdin: { contents: "export { openMediaFile } from './src/api.ts'; export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	define: { _VERSION_: '"2.0.0-alpha"' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { openMediaFile, encodeProjectFile, decodeProjectFile } = module.exports;

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
		const encoded = await encodeProjectFile({ generatedSpeech: [], timelineFps: 60,
			timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, timelineScenes: [],
			assets: [{ ...source, id: 'lut', name: 'Renamed', fileDataType: source.type }] });
		const restored = decodeProjectFile(encoded).assets[0];
		assert.equal(restored.name, 'Renamed');
		assert.equal(restored.fileDataType, 'application/x-cube-lut');
		assert.equal(await restored.fileData.text(), text);
	}
	assert.equal(decodedSources.length, 0);
});

// 【複数選択で取り込むすべての素材に、それぞれの原本パスを記録する】
// フォントや音声だけメタデータが欠落したり、選択した先頭のパスを使い回したりしない。
// Blobへのコピー前のFileをデスクトップAPIへ渡し、プロジェクトの保存・再読込でもパスを保つ。
test('retains each source path when selecting multiple desktop media files', async t => {
	const { input } = setupMedia(t);
	const files = mediaTypes.map(media => new File([`encoded ${media.name}`], media.name, { type: media.type }));
	const paths = files.map(file => `C:\\素材 フォルダ\\${file.name}`);
	const requestedFiles = [];
	window.desktop = { getPathForFile(file) {
		requestedFiles.push(file);
		assert.ok(files.includes(file), 'The bridge must receive the original File');
		return paths[files.indexOf(file)];
	} };
	const pending = openMediaFile({ multiple: true, includeFonts: true });
	input.files = files;
	input.onchange();
	const imported = await pending;
	assert.deepEqual(requestedFiles, files);
	assert.deepEqual(imported.map(source => source.sourceFilePath), paths);
	const encoded = await encodeProjectFile({ generatedSpeech: [], timelineFps: 60,
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
			const encoded = await encodeProjectFile({ generatedSpeech: [], timelineFps: 60,
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
	const encoded = await encodeProjectFile({ generatedSpeech: [], timelineFps: 60,
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
// Open image/video/audioは素材に対応したプロジェクトを作るため、汎用ファイルを渡さない。
test('keeps media-only imports restricted when arbitrary file support is not requested', async t => {
	const platform = setupMedia(t);
	await assert.rejects(openMediaFile({ file: new File(['text'], 'notes.txt', { type: 'text/plain' }) }), /Unsupported media type/);
	assert.deepEqual(platform.decodedSources, []);
});
