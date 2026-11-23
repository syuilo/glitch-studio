import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
import { createAudioWindowReader } from '@gs/subsystems_effect_native-effects/audio-window.ts';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
const { AudioHistory } = await load('@gs/subsystems_audio_renderer/audio-history.ts');
const { createEffectLivePreviewInputs } = await loadShaderSource(fileURLToPath(new URL('../src/effect-live-preview-inputs.ts', import.meta.url)));
const { EffectLivePreviewAudio, EffectLivePreviewAudioCapture } = await loadShaderSource(fileURLToPath(new URL('../src/effect-live-preview-audio.ts', import.meta.url)));
import { createTimelineEffectProbe } from './helpers/timeline-effect-probe.mjs';
const { default: waveform } = await load('@gs/subsystems_effect_native-effects/fx/audioWaveform/_impl_.ts');
const { default: waveformDefinition } = await load('@gs/subsystems_effect_native-effects/fx/audioWaveform/_def_.ts');
const literal = value => ({ inputSource: 'literal', value });
const audioDef = waveformDefinition.paramDefs.audio;
const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setImmediate(resolve));
const { createAudioWindow } = await load('@gs/subsystems_audio_shared/audio-window.ts');
const samples = (window, channel = 'left') => Float32Array.from({ length: window.frameCount }, (_, frame) => window.sample(frame, channel));
const window = (left = [1, -1], right = left) => createAudioWindow(48000, [Float32Array.from(left), Float32Array.from(right)]);
const deferred = () => Promise.withResolvers();

async function audioPlacement(bindings, publicAudio = null) {
	const native = { type: 'nativeEffect', id: 'probe' }, amount = { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: {} }, defaultValue: 0 };
	const metadata = { primaryInputParameter: null, primaryOutput: 'output', resolutionInputParameters: [], outputDefs: { output: { dataType: { kind: 'color' } } } };
	const graph = { ...metadata, paramDefs: { sound: { ...audioDef, nameForReference: 'sound' } },
		outputDefs: Object.fromEntries(bindings.map((_, i) => [i, metadata.outputDefs.output])), primaryOutput: '0',
		nodes: bindings.map((params, i) => ({ id: String(i), effectSource: native, params })),
		outputSources: Object.fromEntries(bindings.map((_, i) => [i, { nodeId: String(i), outputPort: 'output' }])) };
	const observed = [];
	const instance = await createEffectInstance({ effectSource: { type: 'inlineNodesEffect', nodesEffect: graph },
		resolution: { width: 2, height: 2 }, usedOutputPorts: new Set(Object.keys(graph.outputDefs)),
		inputs: { sound: { kind: 'value', value: publicAudio } }, definitions: { getNativeEffect: () => ({ ...metadata, paramDefs: { audio: audioDef, amount } }) } },
		{}, () => ({ createOutputTexture: () => ({ destroy() {} }), init({ inputs }) { return { render() { observed.push(inputs.audio.value); }, dispose() {} }; } }));
	return { instance, observed };
}

// 【古いシークの完了・失敗・破棄後の応答を公開しない】
// デコードが順不同で完了しても、新しい音声窓とready状態を古い要求に上書きさせない。
// Noneへの変更も一つの要求なので、処理中だった素材の音声を後から復活させない。
test('discards stale completion and failures after seeking, clearing, and disposal', async () => {
	const reader = createAudioWindowReader();
	const pending = deferred(), cancelled = new AbortController();
	const stale = assert.rejects(reader.prepare({ cacheKey: 'old', readWindow: () => pending.promise }, 0.01, cancelled.signal), { name: 'AbortError' });
	cancelled.abort();
	const latest = window([2, 3]);
	reader.prepare({ cacheKey: 'new', readWindow: () => latest }, 0.01, signal());
	pending.resolve(window()); await stale;
	assert.equal(reader.window, latest);
	reader.prepare(null, 0.01, signal());
	assert.equal(reader.window, null);
});

// 【同じ窓は再取得せず、中断・失敗後は再要求できる】
// プレビュー中断を永続キャッシュにすると、同じ時刻へ戻ったときにloadingのまま停止してしまう。
test('deduplicates ready windows and retries cancelled or failed requests', async () => {
	const reader = createAudioWindowReader();
	let reads = 0;
	const input = { cacheKey: 'frame', readWindow() { reads++; return window(); } };
	reader.prepare(input, 0.01, signal()); reader.prepare(input, 0.01, signal());
	assert.equal(reads, 1);
	reader.prepare(input, 0.02, signal()); assert.equal(reads, 2);
	const broken = { cacheKey: 'broken', readWindow() { throw new Error('decode failed'); } };
	assert.throws(() => reader.prepare(broken, 0.01, signal()), /decode failed/);
	reader.prepare({ ...input, cacheKey: 'broken' }, 0.01, signal());
	assert.equal(reads, 3);
});

// 【一つのプレビュー入力を複数の公開パラメータで共有する】
// 同じ描画ではPCM取得元が一つに固定され、音声の再生位置がEffectのTIMEを上書きしない。
test('shares preview audio across parameters without changing effect time', () => {
	const amount = { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: {} }, defaultValue: 0 };
	const definition = { paramDefs: { first: audioDef, second: audioDef, amount } };
	const binding = { inputSource: 'previewInputAudio' };
	let position = 0.5;
	let reads = 0;
	const inputs = createEffectLivePreviewInputs(definition, { first: binding, second: binding, amount: { inputSource: 'expression', expression: 'TIME' } }, [], {
		image() { throw new Error('Image is unused'); },
		audio() { reads++; return { endFrame: position * 48000 }; },
	});
	const { first, second, amount: time } = inputs.inputs;
	inputs.beginFrame(8000);
	assert.equal(first.value, second.value);
	assert.equal(first.value.endFrame, 24000);
	assert.equal(time.value, 8);
	assert.equal(reads, 1);
	position = 2;
	inputs.beginFrame(8100);
	assert.equal(first.value.endFrame, 96000);
	assert.equal(time.value, 8.1);
});

// 【ライブ音声を描画ごとに固定し、転送バッファをWorkletに返す】
// 次の音声が届いても準備中のEffectには同じPCMを渡す。バッファを返さないと入力が途中で止まる。
test('snapshots captured preview audio and recycles transferred PCM', async t => {
	const { port1, port2 } = new MessageChannel();
	const capture = new EffectLivePreviewAudioCapture(port2, 1);
	t.after(() => { capture.dispose(); port1.close(); });
	assert.equal(capture.snapshot(), null);
	async function append(startFrame, value) {
		const frames = 1024;
		const pcm = new Float32Array(frames * 2);
		pcm.fill(value, 0, frames);
		const recycled = once(port1, 'message');
		port1.postMessage({ type: 'samples', generation: 0, startFrame, sampleRate: 48000, channelCount: 1, frameCount: frames, buffer: pcm.buffer }, [pcm.buffer]);
		const [message] = await recycled;
		assert.equal(message.type, 'recycle');
		new Float32Array(message.buffer).fill(0);
	}
	await append(0, 0.25);
	const first = capture.snapshot();
	await append(1024, 0.5);
	const next = capture.snapshot();
	assert.equal(capture.snapshot(), next);
	assert.equal(next.sourceKey, first.sourceKey);
	assert.notEqual(next.cacheKey, first.cacheKey);
	assert.equal(first.readWindow(0.01, signal()).sample(0, 'right'), 0.25);
	assert.equal(next.readWindow(0.01, signal()).sample(0, 'right'), 0.5);
	await append(4096, 0.75);
	assert.notEqual(capture.snapshot().sourceKey, next.sourceKey);
});

// 【一時停止中のシーク先から音声窓を読み取る】
// Effectの描画が進んでいても、波形やFFTは最後に選んだ素材時刻のPCMを表示する。
test('decodes preview audio at the playback position after seeking', async t => {
	const sampleRate = 8000;
	const bytes = new Uint8Array(44 + sampleRate * 2);
	const view = new DataView(bytes.buffer);
	const text = (offset, value) => bytes.set(new TextEncoder().encode(value), offset);
	text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true); view.setUint16(34, 16, true);
	text(36, 'data'); view.setUint32(40, sampleRate * 2, true);
	for (let frame = 0; frame < sampleRate; frame++) view.setInt16(44 + frame * 2, frame < sampleRate / 2 ? 8192 : 16384, true);
	const audio = new EffectLivePreviewAudio(new Blob([bytes], { type: 'audio/wav' }));
	t.after(() => audio.dispose());
	const previous = audio.atTime(0.25, 1);
	const current = audio.atTime(0.75, 2);
	assert.notEqual(previous.sourceKey, current.sourceKey);
	const read = input => input.readWindow(0.05, signal());
	const [beforeSeek, afterSeek] = await Promise.all([read(previous), read(current)]);
	for (const channel of ['left', 'right']) {
		assert.ok(Math.abs(beforeSeek.sample(1024, channel) - 0.25) < 0.0001);
		assert.ok(Math.abs(afterSeek.sample(1024, channel) - 0.5) < 0.0001);
	}
	assert.equal(audio.atTime(0.75, 2).cacheKey, current.cacheKey);
});

// 【音声公開パラメータは専用入力として渡し、PUBLIC式には公開しない】
// 下層入力の解決をNodes Effectの外側に保ち、内部エフェクトはSceneやレイヤーを知らずに使える。
// canNodeを無効にしても、音声リソースを通常の数値・画像の参照へ流してはいけない。
test('resolves public audio inputs independently of PUBLIC and image parameters', async t => {
	const source = { cacheKey: 'lower', readWindow: () => window() };
	const audio = { inputSource: 'nodesEffectPublicParameterReference', parameterId: 'sound' };
	const invalid = await audioPlacement([{ audio, amount: { inputSource: 'expression', expression: 'PUBLIC("sound")' } }], source);
	t.after(() => invalid.instance.dispose());
	assert.throws(() => invalid.instance.render({ time: 0, timeDelta: 0 }, {}), /unknown parameter/);
	const valid = await audioPlacement([{ audio, amount: literal(0) }], source);
	t.after(() => valid.instance.dispose());
	valid.instance.render({ time: 0, timeDelta: 0 }, {});
	assert.equal(valid.observed[0], source);
});




// 【Nodes Effectの主音声入力はScene時刻で解決し、内容時刻と分離する】
// トリムやNodes Effect内のTIMEを変えても、同じ場所の下層音声が選ばれる必要がある。
// Noneを明示した場合は自動割り当てを上書きし、音声の読み出しも行わない。
test('anchors Nodes Effect audio to scene time while preserving content time and explicit none', async () => {
	const publicAudio = { ...audioDef, id: 'audio-id', nameForReference: 'sound' };
	const calls = [];
	const input = { cacheKey: 'lower', readWindow: () => window() };
	let prepared;
	const create = params => createTimelineEffectProbe({ paramDefs: { [publicAudio.id]: publicAudio }, params, primaryAudioInputParameter: publicAudio.id,
		getAudioInput: (...args) => { calls.push(args); return input; }, render(frame, values) { prepared = { frame, values }; } });
	const renderer = create({});
	const context = { input: { kind: 'uniform', value: [0, 0, 0, 0] }, sceneTimeMs: 600.25, contentTimeMs: 120.25, contentEndTimeMs: 500,
		clipElapsedTimeMs: 100, clipDurationMs: 400, timeDelta: 0, isExport: true };
	await renderer.evaluate(context, signal());
	assert.deepEqual(calls, [[{ inputSource: 'lowerLayerAudio' }, 600.25, true]]);
	assert.equal(prepared.frame.time, 0.12025);
	assert.equal(prepared.values[publicAudio.id], input);
	renderer.destroy();
	const none = create({ [publicAudio.id]: literal(null) });
	await none.evaluate(context, signal());
	assert.equal(prepared.values[publicAudio.id], null);
	none.destroy();
	assert.equal(calls.length, 1);
});

// 【公開音声パラメータごとに参照先を解決し、同じ参照だけをフレーム内で共有する】
// 単一の入力を使い回すと、下層音声と指定レイヤーを同時に使うNodes Effectで誤った波形になる。
// 欠落参照のnullもキャッシュし、次のフレームでは再解決してUndoや編集を反映する。
test('resolves independent public audio sources and shares only matching frame inputs', async () => {
	const bindings = {
		lower: { inputSource: 'lowerLayerAudio' }, first: { inputSource: 'anotherLayerAudio', layerId: 'a' },
		again: { inputSource: 'anotherLayerAudio', layerId: 'a' }, second: { inputSource: 'anotherLayerAudio', layerId: 'b' },
		missing: { inputSource: 'anotherLayerAudio', layerId: 'missing' }, missing_again: { inputSource: 'anotherLayerAudio', layerId: 'missing' },
		none: { inputSource: 'anotherLayerAudio', layerId: null },
	};
	const calls = [];
	let prepared;
	const renderer = createTimelineEffectProbe({ paramDefs: Object.fromEntries(Object.keys(bindings).map(id => [id, audioDef])), params: bindings,
		getAudioInput: (binding, time, isExport) => {
			calls.push([binding, time, isExport]);
			return binding.layerId === 'missing' ? null : { cacheKey: JSON.stringify(binding), readWindow: () => window() };
		},
		render(frame, values) { prepared = new Map(Object.entries(values)); },
	});
	const context = { input: { kind: 'uniform', value: [0, 0, 0, 0] }, sceneTimeMs: 400.25, contentTimeMs: 10, contentEndTimeMs: 100,
		clipElapsedTimeMs: 10, clipDurationMs: 100, timeDelta: 0, isExport: true };
	await renderer.evaluate(context, signal());
	assert.deepEqual(calls, [bindings.lower, bindings.first, bindings.second, bindings.missing].map(binding => [binding, 400.25, true]));
	const inputs = prepared;
	assert.equal(inputs.get('first'), inputs.get('again'));
	assert.notEqual(inputs.get('lower'), inputs.get('first'));
	assert.notEqual(inputs.get('first'), inputs.get('second'));
	assert.equal(inputs.get('missing'), null);
	assert.equal(inputs.get('none'), null);
	await renderer.evaluate(context, signal());
	assert.equal(calls.length, 8);
	assert.notEqual(prepared.get('first'), inputs.get('first'));
});

// 【波形は短いピークを保持し、未選択と無音を区別する】
// GPUへ渡すmin/maxを実エフェクトで検証し、入力変換後にも正規化せず振幅を保つ。
// Stereoは左右を平均した1本の波形、L/Rは選択したチャンネルの波形として検証する。
// ブロック境界の両側にピークを置き、窓を連続配列へコピーせずに読み取れることも確認する。
// 評価済みの振幅・線幅を渡し、既定値をBindingで包むと実装内のフォールバックに隠れることも検出する。
test('uploads selected channel peaks and distinguishes silence from no source', () => {
	globalThis.GPUBufferUsage = { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 };
	const writes = [];
	const device = { createShaderModule: () => ({}), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBuffer: () => ({ destroy() {} }), createBindGroup: () => ({}),
		queue: { writeBuffer: (_buffer, _offset, data) => writes.push([...data]) } };
	const history = new AudioHistory();
	const left = new Float32Array(240);
	const right = new Float32Array(240);
	left[119] = 3; left[120] = -2;
	right[0] = 1; right[119] = -1; right[120] = 2; right[239] = -3;
	for (const [start, end] of [[0, 119], [119, 121], [121, 240]]) {
		history.append({ generation: 1, startFrame: start, sampleRate: 48000, channelCount: 2, frameCount: end - start,
			buffer: Float32Array.from([...left.subarray(start, end), ...right.subarray(start, end)]).buffer });
	}
	const snapshot = history.snapshot();
	const params = { ...Object.fromEntries(Object.entries(waveformDefinition.paramDefs).map(([key, def]) => [key, def.defaultValue])),
		channel: 'stereo', duration: 0.005, color: [1, 0, 0, 0.5], audio: { cacheKey: 'recording', readWindow: () => snapshot.readWindow(240) } };
	history.reset();
	const bound = Object.fromEntries(Object.keys(params).map(key => [key, { kind: 'value', get value() { return params[key]; } }]));
	const instance = waveform.init({ device, resolution: { width: 2, height: 2 }, defaultVertexShaderModule: {}, inputs: bound, outputTextures: new Map([['output', { createView: () => ({}) }]]) });
	const draw = () => {
		const frame = { time: 0, timeDelta: 0 };
		instance.prepare(frame, signal());
		instance.render({ ...frame, commandEncoder: { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) } });
	};
	for (const [channel, peaks] of [
		['stereo', [0, 1, -1.5, 0]],
		['left', [0, 3, -2, 0]],
		['right', [-1, 1, -3, 2]],
	]) {
		params.channel = channel;
		draw();
		assert.deepEqual(writes.at(-1), peaks.map(peak => peak * params.amplitude), channel);
		assert.equal(writes.at(-2)[3], 0.5);
		assert.equal(writes.at(-2)[5], Math.fround(params.lineWidth));
		assert.equal(writes.at(-2)[7], 1);
	}
	params.audio = { cacheKey: 'silence', readWindow: () => window([0, 0]) };
	draw();
	assert.deepEqual(writes.at(-1), [0, 0, 0, 0]);
	assert.equal(writes.at(-2)[7], 1);
	params.audio = null;
	draw();
	assert.deepEqual(writes.at(-1), [0, 0, 0, 0]);
	assert.equal(writes.at(-2)[7], 0);
	instance.dispose();
});
