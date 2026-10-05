import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ stdin: {
	contents: `export { TimelineAudioRenderer } from './timeline-audio-renderer.ts';
		export { createTimelineAudioInput } from './timeline-audio-input.ts';
		export { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';`,
	resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
}, bundle: true, platform: 'node', format: 'cjs', write: false });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { TimelineAudioRenderer, createTimelineAudioInput, getSceneAudioClips } = loaded.exports;
const literal = value => ({ inputSource: 'literal', value });
const signal = () => new AbortController().signal;
const clip = (assetId, changes = {}) => ({ id: assetId, assetId, startMs: 0, durationMs: 100, contentOffsetMs: 0, ...changes });
const audio = (id, changes = {}) => ({ id, name: id, layerType: 'audio', isDisabled: false,
	clips: [clip(id)], audioParamValues: { volume: literal(1) }, automationGraphs: [], ...changes });
const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });
const waveform = { id: 'waveform', layerType: 'effect', name: 'Waveform', effectId: 'audioWaveform', resolution: { mode: 'auto' }, isDisabled: false,
	clips: [{ id: 'wave', startMs: 0, durationMs: 100, contentOffsetMs: 0 }], effectParamValues: {}, compositingParamValues: {}, automationGraphs: [] };
const constant = async (_id, _time, frames) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(-0.5)];

// 【下層だけを選び、子Sceneの内部には親のレイヤー境界を持ち込まない】
// 配列は上から下の順なので、波形レイヤー自身と上層は入力に含めない。
// 子Sceneは全体の出力として扱い、動画の音声無効化と非表示も通常再生と同じ計画で除外する。
test('selects only lower layers and includes complete nested scene audio', async () => {
	const child = scene('child', [audio('child-top'), audio('child-bottom')]);
	const nested = audio('nested', { layerType: 'scene', clips: [{ id: 'nested', sceneId: 'child', startMs: 0, durationMs: 100, contentOffsetMs: 0 }],
		audioParamValues: { volume: literal(0.5) }, compositingParamValues: {} });
	const video = audio('video', { layerType: 'video', clips: [clip('video', { audioEnabled: true }), clip('muted-video', { startMs: 100, audioEnabled: false })], compositingParamValues: {} });
	const root = scene('root', [audio('above'), waveform, nested, video, audio('hidden', { isDisabled: true })]);
	const plan = getSceneAudioClips([root, child], 'root', 'waveform');
	assert.deepEqual(plan.map(item => item.assetId), ['child-top', 'child-bottom', 'video']);
	const renderer = new TimelineAudioRenderer(constant);
	const result = await createTimelineAudioInput(renderer, plan, 50, 'revision', false).readWindow(0.01, signal());
	assert.deepEqual(result.channels[0], new Float32Array(480).fill(2));
	assert.deepEqual(result.channels[1], new Float32Array(480).fill(-1));
	assert.deepEqual(getSceneAudioClips([root, child], 'root', 'hidden'), []);
	assert.throws(() => getSceneAudioClips([root, child], 'root', 'missing'), /layer not found/);
	// 並び替え後は、それまで上層だった音声も入力になる。
	const reordered = { ...root, layers: [waveform, ...root.layers.filter(layer => layer !== waveform)] };
	assert.equal(getSceneAudioClips([reordered, child], 'root', 'waveform')[0].assetId, 'above');
});

// 【波形の窓は過去のクリップも含み、Scene先頭より前と表示区間外は無音にする】
// 現在有効なクリップだけを集める実装では、クリップ終端を越えた瞬間に波形の履歴が消える。
// 素材オフセットは小数を維持し、音量適用後のピークを正規化・クリップしない。
test('reads historical clips across silence and preserves fractional source offsets and gain', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); });
	const root = scene('root', [waveform, audio('short', { clips: [clip('short', { durationMs: 2, contentOffsetMs: 0.125 })], audioParamValues: { volume: literal(3) } })]);
	const input = createTimelineAudioInput(renderer, getSceneAudioClips([root], 'root', 'waveform'), 4, 'r', false);
	const result = await input.readWindow(0.006, signal());
	assert.equal(result.sampleRate, 48000);
	assert.deepEqual(calls, [['short', 0.000125, 96, 48000]]);
	assert.deepEqual(result.channels[0], Float32Array.from([...Array(96).fill(0), ...Array(96).fill(3), ...Array(96).fill(0)]));
});

// 【シーク順序や書き出しによらず同じ時刻のPCMを得る】
// 音声の時計をフレーム数や再生ヘッドから導くと、停止プレビューやモーションブラーで結果が変わる。
// 小数msの各サブフレームを48kHzの半開区間へ変換し、毎回同じサンプルを選ぶ。
test('is deterministic across seeking and export and distinguishes fractional sample times', async () => {
	const renderer = new TimelineAudioRenderer(async (_id, time, frames, rate) => {
		const samples = Float32Array.from({ length: frames }, (_, index) => time + index / rate);
		return [samples, samples.slice()];
	});
	const root = scene('root', [waveform, audio('ramp', { audioParamValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 10' } } })]);
	const plan = getSceneAudioClips([root], 'root', 'waveform');
	const read = (time, isExport = false) => createTimelineAudioInput(renderer, plan, time, 'r', isExport).readWindow(0.005, signal());
	const expected = await read(10.01);
	await read(80);
	await read(1);
	assert.deepEqual(await read(10.01), expected);
	assert.deepEqual(await read(10.01, true), expected);
	assert.notDeepEqual(await read(10.04), expected);
	const lastTime = 480 / 48000;
	assert.ok(Math.abs(expected.channels[0].at(-1) - lastTime) < 1e-8);
});

// 【デコード失敗とキャンセルを無音として成功させない】
// 書き出しは準備完了まで待つため、失敗を握りつぶすと欠けた波形のまま動画が完成してしまう。
test('propagates source failures and rejects cancelled windows', async () => {
	const root = scene('root', [waveform, audio('broken')]);
	const renderer = new TimelineAudioRenderer(async () => { throw new Error('decode failed'); });
	const input = createTimelineAudioInput(renderer, getSceneAudioClips([root], 'root', 'waveform'), 50, 'r', false);
	await assert.rejects(input.readWindow(0.01, signal()), /decode failed/);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(input.readWindow(0.01, controller.signal), { name: 'AbortError' });
});
