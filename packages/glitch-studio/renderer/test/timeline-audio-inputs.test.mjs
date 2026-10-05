import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelineAudioInputs } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-audio-inputs.ts', import.meta.url)));
const samples = (window, channel = 'left') => Float32Array.from({ length: window.frameCount }, (_, frame) => window.sample(frame, channel));
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
	const read = (time, signal = new AbortController().signal) => inputs.getInput(scenes, 'scene', 'waveform', { inputSource: 'lowerLayerAudio' }, time, false).readWindow(0.01, signal);
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
		assert.ok(samples(result).every(value => Math.abs(value - 0.25) < 0.0001));
	} finally {
		f.release.resolve();
		f.inputs.dispose();
		await f.closed.promise;
	}
});

// 【入力方式・参照先・Scene更新をキャッシュで区別し、参照の削除と復元を反映する】
// 下層用の計画を指定レイヤーへ流用すると、並び替えや音量編集後に別の音声を表示する。
// 同じIDが他Sceneにあっても探しに行かず、削除中は入力なし、Undo後は再び音声を得る。
test('separates source plans and refreshes selected audio after edits and restoration', async () => {
	const f = fixture();
	f.release.resolve();
	let current = structuredClone(scenes);
	const binding = { inputSource: 'layerAudio', layerId: 'audio' };
	const input = (selection = binding) => f.inputs.getInput(current, 'scene', 'waveform', selection, 500, false);
	const read = value => value.readWindow(0.01, new AbortController().signal);
	try {
		const original = input();
		assert.notEqual(original.cacheKey, input({ inputSource: 'lowerLayerAudio' }).cacheKey);
		assert.equal(original.cacheKey, input().cacheKey);
		assert.ok(Math.abs((await read(original)).sample(0, 'left') - 0.25) < 0.000001);
		current = structuredClone(current);
		current[0].layers.reverse();
		current[0].layers[0].name = 'Renamed';
		current[0].layers[0].audioParamValues.volume = literal(2);
		assert.notEqual(input().cacheKey, original.cacheKey);
		assert.ok(Math.abs((await read(input())).sample(0, 'left') - 0.5) < 0.000001);
		assert.ok(samples(await read(input({ inputSource: 'lowerLayerAudio' }))).every(value => value === 0));
		// 名前や並び順は保存された参照IDを書き換えない。
		assert.deepEqual(binding, { inputSource: 'layerAudio', layerId: 'audio' });
		const restored = structuredClone(current);
		current = [{ ...current[0], layers: [current[0].layers[1]] }, { ...restored[0], id: 'other-scene', layers: [restored[0].layers[0]] }];
		assert.equal(input(), null);
		assert.equal(input({ inputSource: 'layerAudio', layerId: null }), null);
		assert.equal(input({ inputSource: 'layerAudio', layerId: 'waveform' }), null);
		current = restored;
		assert.ok(Math.abs(samples(await read(input()))[0] - 0.5) < 0.000001);
		current = structuredClone(restored);
		current[0].layers[0].isDisabled = true;
		assert.ok(input() !== null, 'A disabled source is silence, not a missing input');
		assert.ok(samples(await read(input())).every(value => value === 0));
	} finally {
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
