import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { default: implementation } = await load('@gs/subsystems_effect_shared/fx/audioSpectrum/_impl_.ts');
const { default: definition } = await load('@gs/subsystems_effect_shared/fx/audioSpectrum/_def_.ts');
const { createTimelineAudioInput } = await load('@gs/subsystems_timeline_audio-renderer/timeline-audio-input.ts');
const { TimelineAudioRenderer } = await load('@gs/subsystems_timeline_audio-renderer/timeline-audio-renderer.ts');
const { createAudioWindow } = await load('@gs/subsystems_audio_shared/audio-window.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
	globalThis.GPUBufferUsage = { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 };
	const writes = [];
	const statuses = [];
	const device = { createShaderModule: () => ({}), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBuffer: () => ({ destroy() {} }), createBindGroup: () => ({}),
		queue: { writeBuffer: (_buffer, _offset, data) => writes.push([...data]) } };
	const instance = implementation.init({ wgpu: { device }, resolution: { width: 128, height: 128 }, reportStatus: status => statuses.push(status) });
	const params = { ...Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, def.defaultValue.value])),
		fftSize: '256', window: 'rectangular', smoothing: 0, minFrequency: 0, maxFrequency: 24000, color: [1, 0.5, 0, 0.25] };
	const draw = () => instance.render({ params, outputDataMap: { output: { textureView: {} } }, createPassEncoderFor: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) });
	return { instance, params, draw, statuses, writes, data: () => writes.at(-1), visible: () => writes.at(-2)[10] };
}
function input(endFrame, sample = () => 1, overrides = {}) {
	return { cacheKey: `audio-${endFrame}`, sourceKey: 'audio', sampleRate: 48000, startFrame: -Infinity, endFrame, ...overrides,
		readWindow(duration, signal) {
			signal.throwIfAborted();
			const frames = Math.round(duration * this.sampleRate);
			return createAudioWindow(this.sampleRate, [0, 1].map(channel => Float32Array.from({ length: frames }, (_, index) => sample(endFrame - frames + index, channel))));
		} };
}

// 【同じ描画のprepare/renderでFFTや読み出しを重複させず、FFTサイズ変更だけで平滑化を初期化する】
// UI再描画が音声の時間を進めると停止中に見た目が変わる。未選択では保持した平滑化を描画しない。
// 色のalphaもGPUへ渡し、透明度を固定値に置き換えないことを確認する。
test('integrates synchronous audio, duplicate draws, no source, and FFT size changes', () => {
	const f = fixture();
	let reads = 0;
	const source = input(256);
	const read = source.readWindow.bind(source);
	source.readWindow = (...args) => { reads++; return read(...args); };
	f.params.audio = source;
	f.params.smoothing = 0.15;
	f.instance.prepare(f.params);
	f.draw();
	const first = f.data();
	assert.equal(f.visible(), 1);
	assert.equal(f.writes.at(-2)[3], 0.25);
	f.draw();
	assert.deepEqual(f.data(), first);
	assert.equal(reads, 1);
	f.params.audio = input(319);
	f.draw();
	assert.deepEqual(f.data(), first);
	f.params.audio = null;
	f.draw();
	assert.equal(f.visible(), 0);
	f.params.audio = input(256, () => 0, { sourceKey: 'silent' });
	f.draw();
	assert.ok(f.data().some(value => value > 0));
	f.params.fftSize = '512';
	f.draw();
	assert.ok(f.data().every(value => value === 0));
	assert.equal(f.visible(), 1);
	f.instance.dispose();
});

// 【TimelineのPCMを待機し、Scene時刻の周波数ピークを左右別々に描画する】
// Playerに依存したままではTimelineから渡す音声を描画できない。
// 48kHz・ミックス後のPCMから想定binのピークを作り、シーク後も同じ周波数範囲へ写す。
test('renders a prepared timeline spectrum from scene-anchored stereo PCM', async () => {
	const f = fixture();
	const renderer = new TimelineAudioRenderer(async (_id, time, frames, sampleRate) => [
		Float32Array.from({ length: frames }, (_, index) => Math.sin(2 * Math.PI * 3000 * (time + index / sampleRate))),
		Float32Array.from({ length: frames }, (_, index) => 0.5 * Math.sin(2 * Math.PI * 6000 * (time + index / sampleRate))),
	]);
	const clips = [{ assetId: 'tone', startMs: 0, endMs: 1000, sourceStartMs: 0, gains: [] }];
	f.params.audio = createTimelineAudioInput(renderer, clips, 50.25, 'lower', false);
	f.instance.prepare(f.params);
	assert.equal(f.statuses.at(-1).type, 'loading');
	await tick();
	assert.equal(f.statuses.at(-1).type, 'ready');
	f.draw();
	const left = f.data().filter((_, index) => index % 4 === 1);
	const right = f.data().filter((_, index) => index % 4 === 3);
	assert.equal(left.indexOf(Math.max(...left)), 15);
	assert.equal(right.indexOf(Math.max(...right)), 31);
	assert.ok(Math.max(...left) > Math.max(...right));
	f.params.audio = createTimelineAudioInput(renderer, clips, 10.25, 'lower', true);
	f.instance.prepare(f.params);
	await tick();
	f.draw();
	assert.equal(f.visible(), 1);
	assert.ok(f.data().every(Number.isFinite));
	f.instance.dispose();
});

// 【古い非同期要求とキャンセルした窓をFFT履歴に混ぜない】
// デコード完了の順序が逆転しても、音声入力と平滑化は最後に描画した要求だけで更新する。
// 中断後は同じ入力を再準備でき、Noneと破棄後の完了は新しい音声を復活させない。
test('ignores stale asynchronous windows and retries cancelled preparation', async () => {
	const f = fixture();
	const pending = [];
	const asyncInput = (endFrame, value) => {
		const source = input(endFrame, () => value);
		const read = source.readWindow.bind(source);
		source.readWindow = (duration, signal) => {
			const deferred = Promise.withResolvers();
			pending.push({ ...deferred, signal, window: read(duration, signal) });
			return deferred.promise;
		};
		return source;
	};
	f.params.audio = asyncInput(256, 1);
	f.instance.prepare(f.params);
	f.params.audio = asyncInput(512, 0);
	const controller = new AbortController();
	f.instance.prepare(f.params, controller.signal);
	assert.equal(pending[0].signal.aborted, true);
	controller.abort();
	pending[1].resolve(pending[1].window);
	await tick();
	f.instance.prepare(f.params, new AbortController().signal);
	assert.equal(pending.length, 3);
	pending[2].resolve(pending[2].window);
	await tick();
	f.draw();
	assert.ok(f.data().every(value => value === 0));
	pending[0].reject(new Error('stale'));
	await tick();
	assert.equal(f.statuses.at(-1).type, 'ready');
	f.draw();
	assert.ok(f.data().every(value => value === 0));
	for (const clear of [() => { f.params.audio = null; f.instance.prepare(f.params); }, () => f.instance.dispose()]) {
		f.params.audio = asyncInput(1024 + pending.length * 64, 1);
		f.instance.prepare(f.params);
		const late = pending.at(-1);
		clear();
		const statuses = f.statuses.length;
		late.resolve(late.window);
		await tick();
		assert.equal(f.statuses.length, statuses);
		assert.equal(late.signal.aborted, true);
	}
});
