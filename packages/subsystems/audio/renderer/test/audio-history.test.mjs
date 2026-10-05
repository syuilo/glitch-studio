import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	stdin: { contents: "export { AudioHistory } from './audio-history.ts'; export { AudioInputSpectrum } from './audio-input-spectrum.ts'; export { createAudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';",
		resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { AudioHistory, AudioInputSpectrum, createAudioWindow } = module.exports;
const values = (window, channel = 'left') => Array.from({ length: window.frameCount }, (_, frame) => window.sample(frame, channel));
function append(history, startFrame, left, right, overrides = {}) {
	const data = Float32Array.from(right ? [...left, ...right] : left);
	history.append({ type: 'samples', generation: 1, sampleRate: 48000, channelCount: right ? 2 : 1,
		startFrame, frameCount: left.length, buffer: data.buffer, ...overrides });
	return data;
}

// 【受信バッファの再利用・履歴更新・リセットから取得済みのPCMを独立させる】
// 受信bufferはすぐに送信側へ返される。参照だけを保存すると転送後に空になったり、
// 再利用した次の音声で過去の描画結果まで変わるため、取り込み時の所有権移転を確認する。
test('keeps snapshots and windows stable after recycling, appending, and resetting', () => {
	const history = new AudioHistory();
	const captured = append(history, 20, [1, 2, 3], [4, 5, 6]);
	const snapshot = history.snapshot();
	captured.fill(99);
	structuredClone(captured.buffer, { transfer: [captured.buffer] });
	append(history, 23, [7, 8], [9, 10]);
	const window = snapshot.readWindow(5);
	history.reset(2);
	append(history, 0, [-1], [-2], { generation: 2 });
	assert.deepEqual(values(window), [0, 0, 1, 2, 3]);
	assert.deepEqual(values(window, 'right'), [0, 0, 4, 5, 6]);
	assert.deepEqual(values(snapshot.readWindow(2), 'mix'), [3.5, 4.5]);
	assert.equal(window.sample(-1, 'left'), 0);
	assert.equal(window.sample(window.frameCount, 'left'), 0);
});

// 【境界をまたぐ連続走査と、FFTの重複区間・逆方向アクセスで同じ値を読む】
// ブロック位置のキャッシュが前進だけを仮定すると、左右交互の波形や重なったFFT窓で
// 別ブロックのサンプルを返す。欠けている過去だけをゼロ補完し、窓の長さも維持する。
test('reads stereo and mixed samples across blocks in both directions', () => {
	const history = new AudioHistory();
	append(history, 100, [1, 2], [-1, -2]);
	append(history, 102, [3, 4, 5], [-3, -4, -5]);
	append(history, 105, [6], [-6]);
	const window = history.snapshot().readWindow(8);
	for (const frame of [0, 1, 2, 3, 4, 5, 6, 7, 3, 7, 2, 5, 1]) {
		const expected = Math.max(0, frame - 1);
		assert.equal(window.sample(frame, 'left'), expected);
		assert.equal(window.sample(frame, 'right'), expected ? -expected : 0);
		assert.equal(window.sample(frame, 'mix'), 0);
	}
	assert.deepEqual(values(history.snapshot().readWindow(2)), [5, 6]);
});

// 【モノラルの描画窓は左右共有し、既存の履歴利用側の右無音は維持する】
// AudioInputと従来のプレビューはチャンネル契約が異なる。コピー削減でどちらかの
// 音量や右チャンネルの意味が変わらないよう、同じブロックの両方の読み口を確認する。
test('duplicates mono in windows while preserving legacy channel behavior', () => {
	const history = new AudioHistory();
	append(history, 0, [0.25, -0.75]);
	const window = history.snapshot().readWindow(2);
	assert.deepEqual(values(window), values(window, 'right'));
	assert.deepEqual(values(window), values(window, 'mix'));
	assert.equal(history.sample(1, 'right'), 0);
	assert.equal(history.sample(1, 'mix'), -0.75);
});

// 【保持境界の途中にあるブロックを上書きせず、期限切れ部分だけを読めなくする】
// 2秒の境界はキャプチャブロック境界と一致しない。古い窓の値を守りながら、現在の
// 履歴が保持期間外を返さないことと、非常に大きい入力でも末尾だけを保持することを確認する。
test('expires old ranges without mutating pinned blocks and bounds oversized chunks', () => {
	const history = new AudioHistory();
	const first = Float32Array.from({ length: 65536 }, (_, index) => index);
	append(history, 0, first, undefined, { sampleRate: 8000 });
	const old = history.snapshot().readWindow(65536);
	append(history, 65536, [7, 8, 9], undefined, { sampleRate: 8000 });
	assert.equal(history.startFrame, 3);
	assert.equal(history.sample(2, 'left'), 0);
	assert.equal(history.sample(3, 'left'), 3);
	const current = history.snapshot().readWindow(65539);
	assert.deepEqual([0, 1, 2, 3].map(frame => current.sample(frame, 'left')), [0, 0, 0, 3]);
	assert.equal(old.sample(2, 'left'), 2);
	append(history, 0, Float32Array.from({ length: 70000 }, (_, index) => -index), undefined, { sampleRate: 8000, generation: 2 });
	assert.equal(history.startFrame, 4464);
	assert.equal(history.sample(4463, 'left'), 0);
	assert.equal(history.sample(4464, 'left'), -4464);
	assert.equal(history.sample(69999, 'left'), -69999);
	assert.equal(old.sample(65535, 'left'), 65535);
});

// 【世代・連続性・レート・チャンネル数の変更は旧履歴と混ぜない】
// シークや入力差し替えは同じサンプル座標を再利用する。古いブロックを新しい履歴へ
// 混入させず、遅延した旧世代のパケットも無視する必要がある。
test('resets on discontinuities and format changes and ignores stale generations', () => {
	const history = new AudioHistory();
	append(history, 0, [1, 2]);
	const revision = history.revision;
	append(history, 2, [3]);
	assert.equal(history.revision, revision);
	for (const [start, overrides] of [[10, {}], [11, { sampleRate: 44100 }], [12, { sampleRate: 44100, generation: 2 }]]) {
		const before = history.revision;
		append(history, start, [4], undefined, overrides);
		assert.ok(history.revision > before);
		assert.deepEqual(values(history.snapshot().readWindow(2)), [0, 4]);
	}
	append(history, 0, [99]);
	assert.equal(history.endFrame, 13);
	append(history, 13, [5], [6], { generation: 2, sampleRate: 44100 });
	assert.deepEqual(values(history.snapshot().readWindow(2), 'right'), [0, 6]);
});

// 【スナップショット・窓・無音補完でPCM配列を追加確保しない】
// 描画ごとの履歴コピーを復活させないため、時間計測ではなく配列確保の禁止で検証する。
// 長い無音区間でもメモリを長さに比例させず、必要なサンプルだけを読み取れることを確認する。
test('creates snapshots and padded windows without allocating PCM arrays', () => {
	const history = new AudioHistory();
	append(history, 0, [1, 2, 3]);
	const Float32 = globalThis.Float32Array;
	globalThis.Float32Array = new Proxy(Float32, { construct() { throw new Error('Unexpected PCM allocation'); } });
	try {
		for (let i = 0; i < 10; i++) {
			const snapshot = history.snapshot();
			const window = snapshot.readWindow(1_000_000_000);
			assert.equal(window.frameCount, 1_000_000_000);
			assert.equal(window.sample(0, 'left'), 0);
			assert.equal(window.sample(window.frameCount - 1, 'right'), 3);
		}
	} finally {
		globalThis.Float32Array = Float32;
	}
});

// 【ブロックの区切り方によらずFFTと平滑化の結果を維持する】
// 波形は複数ブロックをまたぎ、FFTは重複区間を巻き戻して解析する。
// 連続配列と同じ入力を異なる長さのブロックで供給し、描画間引き後の左右の結果まで比較する。
test('matches contiguous FFT analysis across uneven blocks and catch-up windows', () => {
	const history = new AudioHistory();
	const dense = new AudioInputSpectrum(256);
	const blocked = new AudioInputSpectrum(256);
	const tone = (frame, side) => frame < 1200 ? Math.sin(frame * (side + 1) * 0.17) : 0;
	for (const endFrame of [300, 701, 1243, 2000]) {
		for (let start = history.endFrame; start < endFrame;) {
			const count = Math.min(73, endFrame - start);
			append(history, start, Float32Array.from({ length: count }, (_, i) => tone(start + i, 0)),
				Float32Array.from({ length: count }, (_, i) => tone(start + i, 1)));
			start += count;
		}
		const metadata = { sourceKey: 'tone', sampleRate: 48000, startFrame: 0, endFrame };
		const request = blocked.plan(metadata, 'stereo', 'hann');
		const count = Math.round(request.durationSeconds * metadata.sampleRate);
		const samples = [0, 1].map(side => Float32Array.from({ length: count }, (_, i) => tone(endFrame - count + i, side)));
		blocked.update(request, history.snapshot().readWindow(count), 0.15);
		dense.update(dense.plan(metadata, 'stereo', 'hann'), createAudioWindow(48000, samples), 0.15);
		assert.deepEqual(blocked.left, dense.left);
		assert.deepEqual(blocked.right, dense.right);
	}
});
