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
	const previous = ['window', 'HTMLVideoElement', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
	t.after(() => {
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});
	const decodedSources = [];
	const activeUrls = new Map();
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
		return new EventTarget();
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
	return { decodedSources, activeUrls, get closedBitmaps() { return closedBitmaps; } };
}

const mediaTypes = [
	{ name: 'image.png', type: 'image/png', width: 4, height: 2 },
	{ name: 'movie.mp4', type: 'video/mp4', width: 4, height: 2 },
	{ name: 'sound.wav', type: 'audio/wav', width: 0, height: 0 },
	{ name: 'font.ttf', type: '', expectedType: 'font/ttf', width: 0, height: 0 },
];

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
			const encoded = await encodeProjectFile({ timelineFps: 60,
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
