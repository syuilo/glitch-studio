import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelineAudioInputs } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-audio-inputs.ts', import.meta.url)));
const literal = value => ({ inputSource: 'literal', value });
const scenes = [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
	{ id: 'waveform', name: 'Waveform', layerType: 'effect', effectId: 'audioWaveform', resolution: { mode: 'auto' }, isDisabled: false,
		clips: [{ id: 'wave', startMs: 0, durationMs: 10000, contentOffsetMs: 0 }], effectParamValues: {}, compositingParamValues: {}, automationGraphs: [] },
	{ id: 'audio', name: 'Audio', layerType: 'audio', isDisabled: false, automationGraphs: [], audioParamValues: { volume: literal(1) },
		clips: [{ id: 'sound', assetId: 'asset', startMs: 0, durationMs: 10000, contentOffsetMs: 0 }] },
] }];

function fixture() {
	const started = Promise.withResolvers();
	const release = Promise.withResolvers();
	const closed = Promise.withResolvers();
	const starts = [];
	let active = 0;
	const assets = [{ id: 'asset', name: 'Sound', fileData: new Blob() }];
	const inputs = new TimelineAudioInputs(assets, async () => ({ durationSeconds: 10, sampleRate: 1000,
		async *readBlocks(start, end) {
			assert.equal(active, 0, 'Decoder reads must remain serialized');
			active++;
			try {
				starts.push(start);
				if (starts.length === 1) { started.resolve(); await release.promise; }
				const first = Math.floor(start * 1000);
				const frames = Math.ceil(end * 1000) - first;
				yield { time: first / 1000, rate: 1000, channels: [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(0.25)] };
			} finally { active--; }
		},
		dispose() { assert.equal(active, 0); closed.resolve(); },
	}));
	const read = (time, signal = new AbortController().signal) => inputs.getInput(scenes, 'scene', 'waveform', time, false).readWindow(0.01, signal);
	return { inputs, started, release, closed, starts, read };
}

// 【キュー待機中の中断は、素材読み取りを開始せずに後続へ進む】
// 同じデコーダーを直列に使う制約を守りつつ、不要になったシーク先の窓を読まない。
// キャンセルのrejectでキュー全体が失敗し、最新の描画まで止まることも防ぐ。
test('skips cancelled queued reads and continues with the latest window', async () => {
	const f = fixture();
	try {
		const first = f.read(500);
		await f.started.promise;
		const controller = new AbortController();
		const cancelled = assert.rejects(f.read(4500, controller.signal), { name: 'AbortError' });
		controller.abort();
		const latest = f.read(6500);
		f.release.resolve();
		await first;
		await cancelled;
		const result = await latest;
		assert.equal(f.starts.length, 2);
		assert.equal(f.starts[0], 0);
		assert.ok(f.starts[1] > 5, 'The cancelled four-second window must not be decoded');
		assert.ok(result.channels[0].every(value => Math.abs(value - 0.25) < 0.0001));
	} finally {
		f.release.resolve();
		f.inputs.dispose();
		await f.closed.promise;
	}
});

// 【中断された読み取りも、反復の終了後にデコーダーを解放する】
// 破棄で資源を先に閉じると、待機中のデコードが解放済み資源へアクセスしてしまう。
test('waits for a cancelled active decode before disposing its resources', async () => {
	const f = fixture();
	const controller = new AbortController();
	const cancelled = assert.rejects(f.read(500, controller.signal), { name: 'AbortError' });
	await f.started.promise;
	controller.abort();
	f.inputs.dispose();
	f.release.resolve();
	await cancelled;
	await f.closed.promise;
});
