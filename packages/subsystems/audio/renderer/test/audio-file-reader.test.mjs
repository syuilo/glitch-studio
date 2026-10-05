import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ stdin: {
	contents: "export { AudioFileReader } from './audio-file-reader.ts'; export { openAudioFile } from './audio-file.ts';",
	resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
}, bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { AudioFileReader, openAudioFile } = module.exports;

function wav(rate = 8000, valueAt = () => 0.25, seconds = 3) {
	const frames = rate * seconds;
	const buffer = new ArrayBuffer(44 + frames * 2);
	const data = new DataView(buffer);
	const text = (offset, value) => [...value].forEach((char, i) => data.setUint8(offset + i, char.charCodeAt(0)));
	text(0, 'RIFF'); data.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
	data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
	data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
	text(36, 'data'); data.setUint32(40, frames * 2, true);
	for (let i = 0; i < frames; i++) data.setInt16(44 + i * 2, Math.round(valueAt(i / rate) * 32768), true);
	return new Blob([buffer]);
}

// 【実際のWAVデコードと窓境界の再サンプリングを確認する】
// デコーダーのtimestamp・PCMコピー規約の取り違えは、モックでは検出できない。
test('decodes mono PCM, duplicates channels and resamples across cache windows', async () => {
	const file = wav();
	const reader = new AudioFileReader(() => openAudioFile(file));
	try {
		const output = await reader.read('wav', 1.99, 960, 48000);
		assert.equal(output[0].length, 960);
		assert.ok(output[0].every(value => Math.abs(value - 0.25) < 0.0001));
		assert.deepEqual(output[0], output[1]);
		const silence = await reader.read('wav', 3.1, 128, 44100);
		assert.ok(silence[0].every(value => value === 0));
		const sought = await reader.read('wav', 0.5, 128, 44100);
		assert.ok(sought[0].every(value => Math.abs(value - 0.25) < 0.0001));
	} finally { reader.dispose(); }
});

// 【実際のWAV読み取りでも、時間窓の前後にフィルター用のPCMを確保する】
// リサンプラー単体が正しくても、窓の余白不足は周期的なクリック音や境界の減衰を生む。
test('filters decoded WAV audio consistently across cache boundaries and seeks', async () => {
	const file = wav(96000, time => 0.25 * Math.sin(2 * Math.PI * 1000 * time) + 0.25 * Math.sin(2 * Math.PI * 30000 * time));
	const reader = new AudioFileReader(() => openAudioFile(file));
	try {
		const whole = await reader.read('wav', 1.99, 960, 48000);
		const split = await reader.read('wav', 2, 480, 48000);
		for (let i = 0; i < 960; i++) {
			const expected = 0.25 * Math.sin(2 * Math.PI * 1000 * (1.99 + i / 48000));
			assert.ok(Math.abs(whole[0][i] - expected) < 0.0001, `frame ${i}`);
		}
		assert.deepEqual(whole[0].slice(480), split[0]);
	} finally { reader.dispose(); }
});

function decodedSource() {
	const calls = [];
	let disposed = 0;
	return { calls, get disposed() { return disposed; }, async open() {
		return { durationSeconds: 20, sampleRate: 1000, dispose() { disposed++; },
			async *readBlocks(start, end) {
				calls.push([start, end]);
				const first = Math.floor(start * 1000);
				const frames = Math.ceil(end * 1000) - first;
				yield { time: first / 1000, rate: 1000,
					channels: [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(0.25)] };
			},
		};
	} };
}

// 【中断したデコード窓は途中のPCMをキャッシュせず、反復を終了する】
// 中断後に同じ位置へ戻っても欠けた音声を再利用せず、次の窓やブロックの取得を進めない。
test('closes cancelled block reads and retries without caching partial windows', async () => {
	const waiting = Promise.withResolvers();
	const release = Promise.withResolvers();
	let reads = 0;
	let finished = 0;
	let lastBlocks = 0;
	const reader = new AudioFileReader(async () => ({ durationSeconds: 10, sampleRate: 1000, dispose() {},
		async *readBlocks() {
			reads++;
			try {
				for (let block = 0; block < 3; block++) {
					if (reads === 1 && block === 1) { waiting.resolve(); await release.promise; }
					if (block === 2) lastBlocks++;
					yield { time: block, rate: 1000, channels: [new Float32Array(1000).fill(0.25), new Float32Array(1000).fill(0.25)] };
				}
			} finally { finished++; }
		},
	}));
	try {
		const controller = new AbortController();
		const cancelled = assert.rejects(reader.read('source', 0, 10, 1000, controller.signal), { name: 'AbortError' });
		await waiting.promise;
		controller.abort();
		release.resolve();
		await cancelled;
		assert.equal(finished, 1);
		assert.equal(lastBlocks, 0);
		const output = await reader.read('source', 0, 10, 1000);
		assert.equal(reads, 2);
		assert.equal(finished, 2);
		assert.ok(output[0].every(value => Math.abs(value - 0.25) < 0.0001));
	} finally { release.resolve(); reader.dispose(); }
});

// 【ファイルを開く途中の中断ではデコードを始めず、開いた資源の所有権を維持する】
// open自体が中断不能でも、後から返ったファイルを漏らさずdisposeで解放する。
test('stops after opening a cancelled source and retains it for disposal', async () => {
	const opened = Promise.withResolvers();
	const started = Promise.withResolvers();
	const source = decodedSource();
	const reader = new AudioFileReader(() => { started.resolve(); return opened.promise; });
	const controller = new AbortController();
	const cancelled = assert.rejects(reader.read('source', 0, 10, 1000, controller.signal), { name: 'AbortError' });
	await started.promise;
	controller.abort();
	opened.resolve(await source.open());
	await cancelled;
	assert.equal(source.calls.length, 0);
	reader.dispose();
	assert.equal(source.disposed, 1);
});

// 【同じソースの読み取りでは開いた資源を共有する】
// シークやチャンク分割のたびに素材を開き直さず、readerの破棄時に一度だけ解放する。
test('reuses an opened source across PCM reads', async () => {
	const source = decodedSource();
	let opens = 0;
	const reader = new AudioFileReader(async sourceId => { assert.equal(sourceId, 'audio'); opens++; return source.open(); });
	try {
		await reader.read('audio', 0, 10, 1000);
		await reader.read('audio', 4, 10, 1000);
		assert.equal(opens, 1);
	} finally { reader.dispose(); }
	assert.equal(source.disposed, 1);
});

// 【素材の開始前・終了後を含む読み取りでも、指定フレーム数を無音で埋めて返す】
// Timelineは素材長を参照せずに表示区間を要求するので、素材外の扱いと出力長はreaderが保証する。
test('pads both source boundaries with silence while preserving the requested frame count', async () => {
	const source = decodedSource();
	const reader = new AudioFileReader(source.open);
	try {
		const beforeStart = await reader.read('source', -0.002, 4, 1000);
		const afterEnd = await reader.read('source', 19.998, 4, 1000);
		for (let channel = 0; channel < 2; channel++) {
			assert.deepEqual(beforeStart[channel], Float32Array.of(0, 0, 0.25, 0.25));
			assert.deepEqual(afterEnd[channel], Float32Array.of(0.25, 0.25, 0, 0));
		}
	} finally { reader.dispose(); }
});

// 【同じ素材の離れた再生位置でデコード窓を奪い合わない】
// 重なったレイヤーを交互に読んでも、保持済みの窓を毎フレームデコードし直さない。
test('reuses windows for overlapping layers at different source offsets', async () => {
	const source = decodedSource();
	const reader = new AudioFileReader(source.open);
	try {
		for (let i = 0; i < 30; i++) {
			for (const offset of [0.1, 4.1]) {
				const output = await reader.read('asset', offset + i / 30, 33, 1000);
				assert.ok(output[0].every(value => value === 0.25));
			}
		}
		assert.equal(source.calls.length, 2);
	} finally { reader.dispose(); }
	assert.equal(source.disposed, 1);
});

// 【キャッシュ上限は全素材に適用し、最近使った窓を優先する】
// 素材数や読み取り位置が増えてもメモリが増え続けず、追い出した窓だけ再デコードする。
test('evicts the least recently used window within a shared byte budget', async () => {
	const source = decodedSource();
	// 1窓は前後の余白を含めて約17KBなので、2窓だけ保持できる。
	const reader = new AudioFileReader(source.open, { maxCacheBytes: 34000 });
	try {
		await reader.read('a', 0.1, 10, 1000);
		await reader.read('b', 4.1, 10, 1000);
		await reader.read('a', 0.2, 10, 1000);
		await reader.read('a', 8.1, 10, 1000);
		assert.equal(source.calls.length, 3);
		await reader.read('a', 0.3, 10, 1000);
		assert.equal(source.calls.length, 3);
		await reader.read('b', 4.2, 10, 1000);
		assert.equal(source.calls.length, 4);
	} finally { reader.dispose(); }
});

// 【ソースを開く処理が失敗しても、同じIDの次の読み取りで再試行できる】
// Asset解決を外部へ注入した後も、一時的な失敗をキャッシュして永続的な無音にしない。
test('retries a failed source opener and disposes only successfully opened files', async () => {
	const source = decodedSource();
	let attempts = 0;
	const reader = new AudioFileReader(async sourceId => {
		assert.equal(sourceId, 'retry');
		if (++attempts === 1) throw new Error('temporarily unavailable');
		return source.open();
	});
	try {
		await assert.rejects(reader.read('retry', 0, 10, 1000), /temporarily unavailable/);
		assert.deepEqual((await reader.read('retry', 0.1, 10, 1000))[0], new Float32Array(10).fill(0.25));
		assert.equal(attempts, 2);
	} finally { reader.dispose(); }
	assert.equal(source.disposed, 1);
});

// 【キャッシュを無効にしてもデコーダーを再利用し、返却済みのPCMを上書きしない】
// メモリ上限による再デコードが出力へ影響せず、複数の処理で借用窓を破壊しないことを確認する。
test('supports uncached reads without sharing mutable PCM with callers', async () => {
	const source = decodedSource();
	const reader = new AudioFileReader(source.open, { maxCacheBytes: 0 });
	try {
		const first = await reader.read('source', 0.1, 10, 1000);
		first[0].fill(1);
		const second = await reader.read('source', 0.1, 10, 1000);
		assert.deepEqual(second[0], new Float32Array(10).fill(0.25));
		assert.deepEqual(first[0], new Float32Array(10).fill(1));
		assert.equal(source.calls.length, 2);
	} finally { reader.dispose(); }
	assert.equal(source.disposed, 1);
});
