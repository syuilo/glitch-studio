import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	stdin: { contents: "export { AudioSpectrum } from './audio-spectrum.ts'; export { AudioHistory } from './audio-history.ts';", resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { AudioSpectrum, AudioHistory } = module.exports;
const append = (history, startFrame, frames, value = 1, generation = 1) => history.append({
	generation, startFrame, sampleRate: 1024, channelCount: 1, frameCount: frames, buffer: new Float32Array(frames).fill(value).buffer,
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

// 【FFTの共通化後もPlayerプレビューとSpectrogramの解析間隔・初期化通知を維持する】
// Audio Spectrumエフェクトは別の入力契約になるが、既存のAudioHistory利用側は
// 保持履歴の先頭から解析し、Spectrogramへ各hopの結果とリセットを通知し続ける必要がある。
test('preserves legacy history cadence, smoothing, frame callbacks and generation resets', () => {
	const spectrum = new AudioSpectrum(256, 'hann');
	const history = new AudioHistory();
	const frames = [];
	const update = () => spectrum.update(history, 'mix', 0.5, (endFrame, reset) => frames.push([endFrame, reset]));
	append(history, 128, 256);
	update();
	const alpha = Math.exp(-64 / 1024 / 0.5);
	close(spectrum.left[0], 1 - alpha);
	assert.deepEqual(frames, [[384, true]]);
	update();
	assert.equal(frames.length, 1);
	append(history, 384, 128);
	update();
	close(spectrum.left[0], 1 - alpha ** 3);
	assert.deepEqual(frames, [[384, true], [448, false], [512, false]]);
	append(history, 0, 256, 0, 2);
	update();
	assert.deepEqual(frames.at(-1), [256, true]);
	assert.ok(spectrum.left.every(value => value === 0));
});

// 【HOLD解除時は最新のFFT窓から再開する】
// PCMリングに残っているHOLD中の区間を順番に解析すると、解除時に途切れた履歴を埋め戻してしまう。
// 復帰の最初だけ最新の窓を通知し、次からは通常のhop間隔に戻ることを確かめる。
test('starts from the latest FFT window without replaying retained PCM', () => {
	const spectrum = new AudioSpectrum(256, 'hann');
	const history = new AudioHistory();
	const frames = [];
	const onFrame = (endFrame, reset) => frames.push([endFrame, reset]);
	append(history, 128, 1050);
	spectrum.update(history, 'mix', 0, onFrame, true);
	assert.deepEqual(frames, [[1152, true]]);
	append(history, 1178, 102);
	spectrum.update(history, 'mix', 0, onFrame);
	assert.deepEqual(frames, [[1152, true], [1216, false], [1280, false]]);
});
