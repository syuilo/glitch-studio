import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';

const bundle = await build({
	stdin: { contents: `export { TimelineAudioPreview } from './audio/timeline-audio-preview.ts';
		export { PreviewPlaybackController } from './PreviewPlaybackController.ts';`,
	resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	define: { 'import.meta.url': JSON.stringify(new URL('../src/audio/timeline-audio-preview.ts', import.meta.url).href) },
	plugins: [{ name: 'worklet-url', setup(build) {
		build.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'url' }));
		build.onLoad({ filter: /.*/, namespace: 'url' }, () => ({ contents: 'export default "worklet.js";' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { TimelineAudioPreview, PreviewPlaybackController } = module.exports;

async function fixture(t, position = 0, duration = 10000) {
	let now = 1000;
	t.mock.method(performance, 'now', () => now);
	const nodes = [];
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	const previousWorker = globalThis.Worker;
	globalThis.AudioWorkletNode = class {
		port = { onmessage: null, postMessage() {}, close() {} };
		constructor() { nodes.push(this); }
		connect() {}
		disconnect() {}
	};
	globalThis.Worker = class { postMessage() {} terminate() {} };
	const context = {
		state: 'running', sampleRate: 48000, currentTime: 1.1, outputLatency: 0.02,
		audioWorklet: { async addModule() {} },
		timestamp: { contextTime: 1, performanceTime: 1000 },
		getOutputTimestamp() { return this.timestamp; },
	};
	const audio = new TimelineAudioPreview(async () => ({ context }), () => ({ assets: [], generatedSpeech: [], timelineScenes: [], sceneId: null }));
	t.after(() => {
		audio.stop();
		if (previousAudioWorkletNode == null) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousAudioWorkletNode;
		if (previousWorker == null) delete globalThis.Worker;
		else globalThis.Worker = previousWorker;
	});
	audio.start(position, duration);
	await setImmediate();
	return { audio, context, nodes, setNow(value) { now = value; },
		sendClock(clock) { nodes.at(-1).port.onmessage({ data: { type: 'clock', ...clock } }); },
	};
}

function closeTo(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `Expected ${expected}, received ${actual}`); }

// 【音声デバイスの更新間も対になった時刻から連続した再生位置を求める】
// contextTimeだけを使うと階段状の時計になり、フレーム境界で重複や飛びが起きる。
test('interpolates output timestamps between device updates', async t => {
	const f = await fixture(t);
	f.sendClock({ contextFrame: 48000, playedFrames: 0, running: true });
	closeTo(f.audio.currentTime(), 0);
	f.setNow(1005);
	closeTo(f.audio.currentTime(), 5);
	f.context.timestamp = { contextTime: 1.01, performanceTime: 1010 };
	f.setNow(1015);
	closeTo(f.audio.currentTime(), 15);
	assert.equal(f.audio.buffering.value, false);
});

// 【補間後の推定時刻が揺れても、前のフレームへ戻らない】
// 新しいtimestamp対の推定位置が直前の補間位置より少し後退する場合は、音声が追いつくまで
// 表示位置を保持する。Sceneの周回と再シークは別のテストで継続して確認する。
test('keeps playback monotonic across output timestamp estimation jitter', async t => {
	const f = await fixture(t);
	f.sendClock({ contextFrame: 48000, playedFrames: 0, running: true });
	f.setNow(1015);
	closeTo(f.audio.currentTime(), 15);
	f.context.timestamp = { contextTime: 1.01, performanceTime: 1016 };
	f.setNow(1016);
	closeTo(f.audio.currentTime(), 15);
	f.setNow(1022);
	closeTo(f.audio.currentTime(), 16);
});

// 【バッファ不足の停止・再開は、補間した出力時刻に対応するWorkletの時計で判断する】
// RAFの実時間だけで映像を進めると無音中に再生位置が進み、再開時に音声とずれる。
test('holds the consumed position during buffering and resumes at the audible transition', async t => {
	const f = await fixture(t);
	f.sendClock({ contextFrame: 48000, playedFrames: 0, running: true });
	f.sendClock({ contextFrame: 48480, playedFrames: 480, running: false });
	f.setNow(1012);
	closeTo(f.audio.currentTime(), 10);
	assert.equal(f.audio.buffering.value, true);
	f.setNow(1040);
	closeTo(f.audio.currentTime(), 10);
	f.sendClock({ contextFrame: 50400, playedFrames: 480, running: true });
	f.context.timestamp = { contextTime: 1.05, performanceTime: 1050 };
	f.setNow(1055);
	closeTo(f.audio.currentTime(), 15);
	assert.equal(f.audio.buffering.value, false);
});

// 【AudioContext停止中は補間せず直前の位置を保持する】
// 古いperformanceTimeから補間し続けたり、生のcontextTimeへ戻して映像を逆行させたりしない。
test('freezes the last position while the audio context is suspended', async t => {
	const f = await fixture(t);
	f.sendClock({ contextFrame: 48000, playedFrames: 0, running: true });
	f.setNow(1015);
	closeTo(f.audio.currentTime(), 15);
	f.context.state = 'suspended';
	f.setNow(1100);
	closeTo(f.audio.currentTime(), 15);
	assert.equal(f.audio.buffering.value, true);
	f.context.state = 'running';
	f.context.timestamp = { contextTime: 1.015, performanceTime: 1100 };
	f.setNow(1105);
	closeTo(f.audio.currentTime(), 20);
});

// 【音声出力前のゼロ時刻を補間せず、丸めで未来になったtimestampも巻き戻さない】
// 初期値のゼロを基準にperformance.now()を加算すると、再生開始時に時刻が大きく飛ぶ。
test('retains the requested position for uninitialized output timestamps', async t => {
	const f = await fixture(t, 250);
	f.sendClock({ contextFrame: 0, playedFrames: 0, running: true });
	f.context.timestamp = { contextTime: 0, performanceTime: 0 };
	f.setNow(5000);
	assert.equal(f.audio.currentTime(), 250);
	f.context.timestamp = { contextTime: 0, performanceTime: 5001 };
	assert.equal(f.audio.currentTime(), 250);
});

// 【補間した音声位置もScene終端でループし、再シークでは以前の時計を使わない】
// 一時停止後に開始位置へ戻ったり、古いWorkletから届いた通知で新しいシークを上書きしない。
test('wraps interpolated time and discards clocks from a previous seek', async t => {
	const f = await fixture(t, 900, 1000);
	f.sendClock({ contextFrame: 48000, playedFrames: 0, running: true });
	f.setNow(1200);
	closeTo(f.audio.currentTime(), 100);
	const oldNotify = f.nodes.at(-1).port.onmessage;
	f.audio.start(333, 1000);
	await setImmediate();
	oldNotify({ data: { type: 'clock', contextFrame: 0, playedFrames: 5000, running: true } });
	assert.equal(f.audio.currentTime(), 333);
});

// 【10ms刻みの音声デバイス時計とRAFから、30fps・60fpsの全フレームを連続表示する】
// 音声時計の補間と描画タイミングの統一を実クラス同士で組み合わせ、GPU負荷がないのに
// 重複要求やフレーム飛びが起きていた条件を再現する。
test('requests every frame through the interpolated audio clock and playback controller', async t => {
	const f = await fixture(t);
	const previousWindow = globalThis.window;
	let callback = null;
	globalThis.window = { requestAnimationFrame(next) { callback = next; return 1; }, cancelAnimationFrame() { callback = null; } };
	let playback = null;
	t.after(() => {
		playback?.dispose();
		if (previousWindow == null) delete globalThis.window;
		else globalThis.window = previousWindow;
	});
	for (const fps of [30, 60]) {
		f.context.timestamp = { contextTime: 1, performanceTime: 1000 };
		f.setNow(1000);
		// 比較ごとに新しい再生を開始し、前回の消費サンプル数とWorkletの時計をリセットする。
		f.audio.start(0, 10000);
		await setImmediate();
		f.sendClock({ contextFrame: 48000, playedFrames: 0, running: true });
		const requests = [];
		const renderer = { isReady: { value: true }, errorMessage: { value: null }, cancelSeek() {},
			renderTimelineAt(time) { requests.push(Math.round(time * fps / 1000)); } };
		// 準備済みの実音声時計を使い、デバイスやWorkerの実時間での起動待ちだけを省く。
		playback = new PreviewPlaybackController({ stopRenderLoop() {} }, renderer, () => fps, () => 10000,
			{ start() {}, stop() {}, currentTime: () => f.audio.currentTime(), error: f.audio.error });
		playback.playTimeline();
		for (let index = 0; index <= 300; index++) {
			const time = index * 1000 / 60 + (index % 2 === 0 ? 0 : 0.15);
			const deviceTime = Math.floor(time / 10) * 10;
			f.context.timestamp = { contextTime: 1 + deviceTime / 1000, performanceTime: 1000 + deviceTime };
			f.setNow(1000 + time);
			callback(time);
		}
		assert.deepEqual(requests, Array.from({ length: 5 * fps + 1 }, (_, index) => index));
		playback.dispose();
	}
});
