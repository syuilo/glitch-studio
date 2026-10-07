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
const samples = (window, channel = 'left') => Float32Array.from({ length: window.frameCount }, (_, frame) => window.sample(frame, channel));
const contents = window => ({ sampleRate: window.sampleRate, channels: [samples(window), samples(window, 'right')] });
const literal = value => ({ inputSource: 'literal', value });
const signal = () => new AbortController().signal;
const clip = (assetId, changes = {}) => ({ id: assetId, assetId, startMs: 0, durationMs: 100, contentOffsetMs: 0, ...changes });
const audio = (id, changes = {}) => ({ id, name: id, layerType: 'audio', isDisabled: false,
	clips: [clip(id)], audioParamValues: { volume: literal(1) }, automationGraphs: [], ...changes });
const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });
const waveform = { id: 'waveform', layerType: 'effect', name: 'Waveform', effectId: 'audioWaveform', resolution: { mode: 'auto' }, isDisabled: false,
	clips: [{ id: 'wave', startMs: 0, durationMs: 100, contentOffsetMs: 0 }], effectParamValues: {}, compositingParamValues: {}, automationGraphs: [] };
const constant = async (_id, _time, frames) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(-0.5)];

// 【指定レイヤーの音声は並び順に依存せず、他のレイヤーの音声を含めない】
// 上層も参照できる一方、子Scene内部のIDを直接指定することはできない。
// 無効・空・音声無効の動画を選んでも、別のレイヤーへフォールバックさせない。
test('selects one direct audio output regardless of order and rejects descendants', () => {
	const video = audio('video', { layerType: 'video', clips: [clip('muted', { audioEnabled: false }), clip('audible', { startMs: 100, audioEnabled: true })], compositingParamValues: {} });
	const root = scene('root', [audio('above'), waveform, video, audio('hidden', { isDisabled: true }), audio('empty', { clips: [] })]);
	const child = scene('child', [audio('descendant')]);
	const select = id => getSceneAudioClips([root, child], 'root', { type: 'layer', layerId: id });
	const expected = select('above');
	assert.deepEqual(expected.map(item => item.sourceId), ['above']);
	root.layers.reverse();
	root.layers.find(layer => layer.id === 'above').name = 'Renamed';
	assert.deepEqual(select('above'), expected);
	assert.deepEqual(select('video').map(item => item.sourceId), ['audible']);
	assert.deepEqual(select('hidden'), []);
	assert.deepEqual(select('empty'), []);
	assert.throws(() => select('descendant'), /not found in scene/);
	assert.throws(() => select('waveform'), /no audio output/);
});

// 【Sceneレイヤーを指定した音声に配置のトリムと各階層の音量を反映する】
// 同じ子Sceneを複数配置していても、選んだ配置の内容時刻と区間だけを使う。
// 子と親のTIME_MSを混同せず、親のScene時刻で波形の窓を読む必要がある。
test('mixes only the selected scene placement with its offsets, bounds, and gain clocks', async () => {
	const child = scene('child', [audio('child-a', { audioParamValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 10' } } }), audio('child-b')]);
	const nested = audio('nested', { layerType: 'scene', clips: [{ id: 'placement', sceneId: 'child', startMs: 20, durationMs: 10, contentOffsetMs: 5.125 }],
		audioParamValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 20' } }, compositingParamValues: {} });
	const root = scene('root', [audio('unrelated'), nested, waveform, { ...nested, id: 'other-placement', clips: [{ ...nested.clips[0], contentOffsetMs: 50 }] }]);
	const plan = getSceneAudioClips([root, child], 'root', { type: 'layer', layerId: 'nested' });
	assert.deepEqual(plan.map(item => [item.sourceId, item.sourceStartMs, item.startMs, item.endMs]), [['child-a', 14.875, 20, 30], ['child-b', 14.875, 20, 30]]);
	assert.deepEqual(plan[0].gains.map(gain => gain.sceneStartMs), [0, 14.875]);
	const renderer = new TimelineAudioRenderer(constant);
	const read = (time, isExport) => createTimelineAudioInput(renderer, plan, time, 'selected', isExport).readWindow(0.012, signal());
	const pcm = await read(31, false);
	assert.equal(pcm.frameCount, 576);
	for (let i = 0; i < pcm.frameCount; i++) {
		const time = 19 + i / 48;
		const expected = time >= 20 && time < 30 ? (1 + (time - 14.875) / 10) * time / 20 : 0;
		assert.ok(Math.abs(pcm.sample(i, 'left') - expected) < 0.000001);
	}
	await read(90, false);
	assert.deepEqual(contents(await read(31, true)), contents(pcm));
});

// 【下層だけを選び、子Sceneの内部には親のレイヤー境界を持ち込まない】
// 配列は上から下の順なので、波形レイヤー自身と上層は入力に含めない。
// 子Sceneは全体の出力として扱い、動画の音声無効化と非表示も通常再生と同じ計画で除外する。
test('selects only lower layers and includes complete nested scene audio', async () => {
	const child = scene('child', [audio('child-top'), audio('child-bottom')]);
	const nested = audio('nested', { layerType: 'scene', clips: [{ id: 'nested', sceneId: 'child', startMs: 0, durationMs: 100, contentOffsetMs: 0 }],
		audioParamValues: { volume: literal(0.5) }, compositingParamValues: {} });
	const video = audio('video', { layerType: 'video', clips: [clip('video', { audioEnabled: true }), clip('muted-video', { startMs: 100, audioEnabled: false })], compositingParamValues: {} });
	const root = scene('root', [audio('above'), waveform, nested, video, audio('hidden', { isDisabled: true })]);
	const plan = getSceneAudioClips([root, child], 'root', { type: 'belowLayer', layerId: 'waveform' });
	assert.deepEqual(plan.map(item => item.sourceId), ['child-top', 'child-bottom', 'video']);
	const renderer = new TimelineAudioRenderer(constant);
	const result = await createTimelineAudioInput(renderer, plan, 50, 'revision', false).readWindow(0.01, signal());
	assert.deepEqual(samples(result), new Float32Array(480).fill(2));
	assert.deepEqual(samples(result, 'right'), new Float32Array(480).fill(-1));
	assert.deepEqual(getSceneAudioClips([root, child], 'root', { type: 'belowLayer', layerId: 'hidden' }), []);
	assert.throws(() => getSceneAudioClips([root, child], 'root', { type: 'belowLayer', layerId: 'missing' }), /layer not found/);
	// 並び替え後は、それまで上層だった音声も入力になる。
	const reordered = { ...root, layers: [waveform, ...root.layers.filter(layer => layer !== waveform)] };
	assert.equal(getSceneAudioClips([reordered, child], 'root', { type: 'belowLayer', layerId: 'waveform' })[0].sourceId, 'above');
});

// 【波形の窓は過去のクリップも含み、Scene先頭より前と表示区間外は無音にする】
// 現在有効なクリップだけを集める実装では、クリップ終端を越えた瞬間に波形の履歴が消える。
// 素材オフセットは小数を維持し、音量適用後のピークを正規化・クリップしない。
test('reads historical clips across silence and preserves fractional source offsets and gain', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args.slice(0, 4)); return constant(...args); });
	const root = scene('root', [waveform, audio('short', { clips: [clip('short', { durationMs: 2, contentOffsetMs: 0.125 })], audioParamValues: { volume: literal(3) } })]);
	const input = createTimelineAudioInput(renderer, getSceneAudioClips([root], 'root', { type: 'belowLayer', layerId: 'waveform' }), 4, 'r', false);
	assert.equal(input.sampleRate, 48000);
	assert.equal(input.startFrame, -Infinity);
	assert.equal(input.endFrame, 192);
	assert.equal(createTimelineAudioInput(renderer, [], 5, 'r', false).sourceKey, input.sourceKey);
	assert.notEqual(createTimelineAudioInput(renderer, [], 4, 'edited', false).sourceKey, input.sourceKey);
	const result = await input.readWindow(0.006, signal());
	assert.equal(result.sampleRate, 48000);
	assert.deepEqual(calls, [['short', 0.000125, 96, 48000]]);
	assert.deepEqual(samples(result), Float32Array.from([...Array(96).fill(0), ...Array(96).fill(3), ...Array(96).fill(0)]));
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
	const plan = getSceneAudioClips([root], 'root', { type: 'belowLayer', layerId: 'waveform' });
	const read = (time, isExport = false) => createTimelineAudioInput(renderer, plan, time, 'r', isExport).readWindow(0.005, signal());
	const expected = await read(10.01);
	await read(80);
	await read(1);
	assert.deepEqual(contents(await read(10.01)), contents(expected));
	assert.deepEqual(contents(await read(10.01, true)), contents(expected));
	assert.notDeepEqual(contents(await read(10.04)), contents(expected));
	const lastTime = 480 / 48000;
	assert.ok(Math.abs(expected.sample(expected.frameCount - 1, 'left') - lastTime) < 1e-8);
});

// 【デコード失敗とキャンセルを無音として成功させない】
// 書き出しは準備完了まで待つため、失敗を握りつぶすと欠けた波形のまま動画が完成してしまう。
test('propagates source failures and rejects cancelled windows', async () => {
	const root = scene('root', [waveform, audio('broken')]);
	const renderer = new TimelineAudioRenderer(async () => { throw new Error('decode failed'); });
	const input = createTimelineAudioInput(renderer, getSceneAudioClips([root], 'root', { type: 'belowLayer', layerId: 'waveform' }), 50, 'r', false);
	await assert.rejects(input.readWindow(0.01, signal()), /decode failed/);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(input.readWindow(0.01, controller.signal), { name: 'AbortError' });
});

// 【読み取り中に中断した要求は、残りの素材取得や音量評価へ進めない】
// 古い結果を捨てるだけでは、複数クリップ分のデコードが最新の描画と競合し続ける。
// 即時中断に対応しない読み取り側でも、完了後の境界で止められることを確認する。
test('forwards cancellation and stops before reading the remaining clips', async () => {
	const started = Promise.withResolvers();
	const release = Promise.withResolvers();
	const controller = new AbortController();
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (id, time, frames, rate, signal) => {
		assert.equal(signal, controller.signal);
		calls.push(id);
		started.resolve();
		await release.promise;
		return constant(id, time, frames, rate);
	});
	const root = scene('root', [waveform, audio('first'), audio('second')]);
	const input = createTimelineAudioInput(renderer, getSceneAudioClips([root], 'root', { type: 'belowLayer', layerId: 'waveform' }), 50, 'r', false);
	const pending = input.readWindow(0.01, controller.signal);
	const rejected = assert.rejects(pending, { name: 'AbortError' });
	await started.promise;
	controller.abort();
	release.resolve();
	await rejected;
	assert.deepEqual(calls, ['first']);
});
