import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export { AudioInputSpectrum } from './audio-input-spectrum.ts'; export { createAudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';", resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { AudioInputSpectrum, createAudioWindow } = module.exports;

const size = 256;
const rate = 1024;
const hop = size / 4;
const signal = new AbortController().signal;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
function input(endFrame, sample = () => 1, overrides = {}) {
	return {
		cacheKey: `audio-${endFrame}`, sourceKey: 'audio', sampleRate: rate, startFrame: -Infinity, endFrame, ...overrides,
		readWindow(duration) {
			const frames = Math.round(duration * this.sampleRate);
			return createAudioWindow(this.sampleRate, [0, 1].map(channel => Float32Array.from({ length: frames }, (_, index) => {
				const frame = this.endFrame - frames + index;
				return frame < this.startFrame ? 0 : sample(frame, channel);
			})));
		},
	};
}
function update(spectrum, source, { channel = 'stereo', windowName = 'rectangular', smoothing = 0 } = {}) {
	const request = spectrum.plan(source, channel, windowName);
	if (request) spectrum.update(request, source.readWindow(request.durationSeconds, signal), smoothing);
	return request;
}

// 【窓関数で音量を変えず、左右・Mix・DC・Nyquistを正しく解析する】
// 正規化や片側スペクトラムの二倍処理を誤ると、表示範囲の調整では直せない振幅差が生じる。
// Mixは振幅の平均ではなくPCMを足してから解析するので、逆相の音は打ち消される。
test('normalizes periodic windows and handles stereo, phase cancellation, DC and Nyquist', () => {
	for (const windowName of ['hann', 'hamming', 'blackman', 'rectangular']) {
		const spectrum = new AudioInputSpectrum(size);
		const tone = input(256, (frame, channel) => (channel === 0 ? 0.8 : -0.4) * Math.sin(2 * Math.PI * 16 * frame / size));
		update(spectrum, tone, { windowName });
		close(spectrum.left[16], 0.8);
		close(spectrum.right[16], 0.4);
		update(spectrum, tone, { channel: 'mix', windowName });
		close(spectrum.left[16], 0.2);
		update(spectrum, tone, { channel: 'right', windowName });
		close(spectrum.left[16], 0.4);
		update(spectrum, input(320, (_frame, channel) => channel === 0 ? 0.75 : -0.75), { channel: 'mix', windowName });
		assert.ok(spectrum.left.every(value => value === 0));
		update(spectrum, input(640, frame => 0.75 + 0.25 * (-1) ** frame), { windowName });
		close(spectrum.left[0], 0.75);
		close(spectrum.left[size / 2], 0.25);
	}
});

// 【描画の間引きで途中の音を失わず、同じFFT区間と平滑化を使う】
// 1描画1FFTにすると描画間の短い音が消え、fpsで時定数も変わる。
// 初期位置と最後の位置を揃え、サンプル格子に一致しない描画も含めて比較する。
test('matches fine and coarse rendering cadences including short intervening sounds', () => {
	const fine = new AudioInputSpectrum(size);
	const coarse = new AudioInputSpectrum(size);
	const sample = (frame, channel) => frame >= 600 && frame < 720 ? Math.sin(frame * (channel + 1) * 0.3) : 0;
	const options = { smoothing: 0.4, windowName: 'hann' };
	update(fine, input(256, sample), options);
	update(coarse, input(256, sample), options);
	for (let endFrame = 320; endFrame <= 2048; endFrame += hop) update(fine, input(endFrame, sample), options);
	for (const endFrame of [589, 922, 1255, 1588, 1921, 2048]) update(coarse, input(endFrame, sample), options);
	assert.deepEqual(coarse.left, fine.left);
	assert.deepEqual(coarse.right, fine.right);
	assert.ok(coarse.left.some(value => value > 0));
});

// 【同じサンプル位置の再描画では平滑化を進めない】
// 一時停止中のUI更新やprepare/renderの二度呼びでスペクトラムが変わるのを防ぐ。
// 次のhopに満たない音声の追記も、その区間が揃うまでは解析しない。
test('does not smooth twice or read again before the next sample hop', () => {
	const spectrum = new AudioInputSpectrum(size);
	const source = input(257);
	const request = update(spectrum, source, { smoothing: 0.5 });
	const expected = spectrum.left.slice();
	spectrum.update(request, source.readWindow(request.durationSeconds), 0.5);
	assert.deepEqual(spectrum.left, expected);
	assert.equal(spectrum.plan(source, 'stereo', 'rectangular'), null);
	assert.equal(spectrum.plan(input(319), 'stereo', 'rectangular'), null);
	close(update(spectrum, input(320)).durationSeconds, size / rate);
});

// 【入力変更・逆方向シーク・窓関数変更でも平滑化を引き継ぐ】
// 描画履歴への依存を許容するため、解析位置の取り直しで見た目の履歴まで消さない。
// 逆方向の時刻差を平滑化係数へ使わず、常に正の1hopとして更新する。
test('preserves smoothing while reanchoring sources, backwards seeks, windows and channels', () => {
	const spectrum = new AudioInputSpectrum(size);
	const options = { smoothing: 0.5 };
	update(spectrum, input(1024), options);
	let expected = spectrum.left[0];
	const alpha = Math.exp(-hop / rate / options.smoothing);
	for (const [source, changes] of [
		[input(64, () => 0), {}],
		[input(4096, () => 0, { sourceKey: 'replacement' }), {}],
		[input(4096, () => 0, { sourceKey: 'replacement' }), { windowName: 'hann' }],
		[input(4096, () => 0, { sourceKey: 'replacement' }), { windowName: 'hann', channel: 'right' }],
	]) {
		const request = update(spectrum, source, { ...options, ...changes });
		assert.equal(request.firstEndFrame, request.lastEndFrame);
		expected *= alpha;
		close(spectrum.left[0], expected);
	}
	spectrum.disconnect();
	update(spectrum, input(4096, () => 0), options);
	close(spectrum.left[0], expected * alpha);
});

// 【大きなシークの追いつき処理を制限し、Playerの失われた履歴を無音として積み重ねない】
// 平滑化秒数やシーク距離に比例してPCMとFFTが増えると、長時間停止後にUIが固まる。
// 保持範囲を超えた場合も残っている平滑化は引き継ぎ、最大128区間だけを処理する。
test('bounds catch-up work and skips unavailable player history without clearing smoothing', () => {
	const spectrum = new AudioInputSpectrum(size);
	update(spectrum, input(256));
	const far = input(1_000_003, () => 0);
	const request = spectrum.plan(far, 'stereo', 'rectangular');
	assert.equal((request.lastEndFrame - request.firstEndFrame) / hop + 1, 128);
	assert.ok(request.durationSeconds * rate < size + 128 * hop);
	const retained = input(1_000_003, () => 0, { startFrame: 999700 });
	const next = update(spectrum, retained, { smoothing: 0.5 });
	assert.ok(next.firstEndFrame - size >= retained.startFrame);
	close(spectrum.left[0], Math.exp(-hop / rate / 0.5));
	const short = input(1_000_200, () => 1, { startFrame: 1_000_190 });
	assert.equal(update(spectrum, short).firstEndFrame, Math.floor(short.endFrame / hop) * hop);
	assert.ok(spectrum.left.every(Number.isFinite));
});

// 【準備中のキャンセルは解析履歴に影響しない】
// デコードを依頼しただけでカーソルを進めると、後続描画でその区間を読み飛ばしてしまう。
test('plans without advancing state and resets bins only when the sample rate changes', () => {
	const spectrum = new AudioInputSpectrum(size);
	update(spectrum, input(256));
	const skipped = spectrum.plan(input(1024), 'stereo', 'hann');
	assert.ok(skipped);
	assert.equal(spectrum.plan(input(320), 'stereo', 'rectangular').firstEndFrame, 320);
	close(spectrum.left[0], 1);
	update(spectrum, input(512, () => 0, { sampleRate: 2048 }), { smoothing: 0.5 });
	assert.ok(spectrum.left.every(value => value === 0));
});
