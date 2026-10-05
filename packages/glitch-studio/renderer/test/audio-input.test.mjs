import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
import { createVisualModuleRenderer } from './helpers/create-visual-module-renderer.mjs';

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { createAudioWindowLoader } = await load('@gs/subsystems_effect_shared/fx/audioWaveform/audio-window-loader.ts');
const { AudioHistory } = await load('@gs/shared/audio-history.ts');
const { playerAudioSourceId } = await load('@gs/shared/audio.ts');
const { PlayerAudioInputs } = await loadShaderSource(fileURLToPath(new URL('../src/player-audio-inputs.ts', import.meta.url)));
const { VisualModuleRenderer } = await load('@gs/subsystems_visual-module_renderer/visual-module-renderer.ts');
const { createVisualModuleTimelineLayer } = await load('@gs/subsystems_timeline_renderer/visual-module-timeline-layer.ts');
const { default: waveform } = await load('@gs/subsystems_effect_shared/fx/audioWaveform/_impl_.ts');
const { default: waveformDefinition } = await load('@gs/subsystems_effect_shared/fx/audioWaveform/_def_.ts');
const literal = value => ({ inputSource: 'literal', value });
const audioDef = waveformDefinition.paramDefs.audio;
const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setImmediate(resolve));
const window = (left = [1, -1], right = left) => ({ sampleRate: 48000, channels: [Float32Array.from(left), Float32Array.from(right)] });
const deferred = () => Promise.withResolvers();

// 【古いシークの完了・失敗・破棄後の応答を公開しない】
// デコードが順不同で完了しても、新しい音声窓とready状態を古い要求に上書きさせない。
// Noneへの変更も一つの要求なので、処理中だった素材の音声を後から復活させない。
test('discards stale completion and failures after seeking, clearing, and disposal', async () => {
	const statuses = [];
	const loader = createAudioWindowLoader(status => statuses.push(status));
	const old = deferred();
	const current = deferred();
	loader.prepare({ cacheKey: 'old', readWindow: () => old.promise }, 0.01);
	loader.prepare({ cacheKey: 'current', readWindow: () => current.promise }, 0.01);
	current.resolve(window([2, 3]));
	await tick();
	const accepted = loader.window;
	old.reject(new Error('obsolete'));
	await tick();
	assert.equal(loader.window, accepted);
	assert.deepEqual(statuses.at(-1), { type: 'ready' });
	for (const clear of [() => loader.prepare(null, 0.01), () => loader.dispose()]) {
		const late = deferred();
		loader.prepare({ cacheKey: `late-${statuses.length}`, readWindow: () => late.promise }, 0.01);
		clear();
		const count = statuses.length;
		late.resolve(window());
		await tick();
		assert.equal(loader.window, null);
		assert.equal(statuses.length, count);
	}
});

// 【同じ窓は再取得せず、中断・失敗後は再要求できる】
// プレビュー中断を永続キャッシュにすると、同じ時刻へ戻ったときにloadingのまま停止してしまう。
test('deduplicates ready windows and retries cancelled or failed requests', async () => {
	const statuses = [];
	const loader = createAudioWindowLoader(status => statuses.push(status));
	let reads = 0;
	const input = { cacheKey: 'frame', readWindow: () => { reads++; return window(); } };
	const controller = new AbortController();
	loader.prepare(input, 0.01, controller.signal);
	loader.prepare(input, 0.01);
	assert.equal(reads, 1);
	controller.abort();
	loader.prepare(input, 0.01, signal());
	assert.equal(reads, 2);
	loader.prepare({ cacheKey: 'broken', readWindow: () => { throw new Error('decode failed'); } }, 0.01);
	assert.deepEqual(statuses.at(-1), { type: 'error', message: 'decode failed' });
	assert.equal(loader.window, null);
	loader.prepare({ ...input, cacheKey: 'broken' }, 0.01);
	assert.deepEqual(statuses.at(-1), { type: 'ready' });
});

// 【LIVEのモノラルを両チャンネルへ複製し、取得後の履歴更新から独立させる】
// 同じPlayerを使う複数ノードや非同期準備の途中で、波形が別の再生位置へ変わらないようにする。
test('freezes player PCM, pads missing history, and duplicates mono channels', () => {
	const history = new AudioHistory();
	const append = (values, generation) => history.append({ generation, startFrame: 0, sampleRate: 1000, channelCount: 1, frameCount: values.length, buffer: Float32Array.from(values).buffer });
	append([1, 2, 3], 1);
	const sources = new Map([[playerAudioSourceId('player'), history]]);
	const inputs = new PlayerAudioInputs(sources);
	const selection = { type: 'player', playerId: 'player' };
	const input = inputs.resolve(selection);
	append([9, 8, 7], 2);
	const result = input.readWindow(0.005, signal());
	assert.deepEqual(result.channels, [Float32Array.from([0, 0, 1, 2, 3]), Float32Array.from([0, 0, 1, 2, 3])]);
	assert.notEqual(input.cacheKey, inputs.resolve(selection).cacheKey);
});

// 【同じ取得元のスナップショットをノード間と停止中の描画間で共有する】
// 波形ノードを増やすたびに全履歴を複製せず、更新のないフレームでもコピーを繰り返さない。
// 公開入力とノード内の指定は同じ取得元として解決する。
test('shares player snapshots across nodes, public inputs, and unchanged frames', () => {
	const history = new AudioHistory();
	history.append({ generation: 1, startFrame: 0, sampleRate: 1000, channelCount: 1, frameCount: 2, buffer: Float32Array.of(1, 2).buffer });
	const inputs = new PlayerAudioInputs(new Map([[playerAudioSourceId('player'), history]]));
	const selection = { type: 'player', playerId: 'player' };
	const renderer = createVisualModuleRenderer(VisualModuleRenderer, { resolveAudioSource: value => inputs.resolve(value) });
	const nodes = ['first', 'second'].map(id => ({ id, type: 'effect', effectId: 'probe', params: { audio: literal(selection) } }));
	const publicAudio = { ...audioDef, id: 'sound', nameForReference: 'Sound' };
	nodes[1].params.audio = { inputSource: 'externalCustomParameterInput', parameterId: publicAudio.id };
	Object.assign(renderer, { nodes, paramDefs: [publicAudio], effectDefinitions: { probe: { paramDefs: { audio: audioDef } } } });
	const publicInput = inputs.resolve(selection);
	// すでに取得したPCMを再利用できれば、履歴へ再アクセスする必要はない。
	history.sample = () => { throw new Error('Unchanged history must not be copied again'); };
	for (let frame = 0; frame < 2; frame++) {
		renderer.evaluateParameters({ time: frame, endTime: Infinity, isExport: false, evaluatedParamValues: new Map([[publicAudio.id, selection]]) });
		for (const node of nodes) assert.equal(renderer.resolveParams(node, renderer.evaledNodeParams.get(node.id)).audio, publicInput);
	}
	renderer.destroy();
});

// 【追記・リセット・同じIDの取得元差し替えをキャッシュへ反映する】
// 通常の追記ではrevisionが変わらず、差し替えでは同じカウンター値になり得る。
// 入力が変わるたびにEffectの窓キャッシュも無効化し、古いPCMは保持済みの描画専用に残す。
test('invalidates player snapshots on append, reset, replacement, and disconnect', () => {
	const history = new AudioHistory();
	const append = (target, startFrame, values) => target.append({ generation: 1, startFrame, sampleRate: 1000, channelCount: 1,
		frameCount: values.length, buffer: Float32Array.from(values).buffer });
	append(history, 0, [1, 2]);
	const sources = new Map([[playerAudioSourceId('player'), history]]);
	const inputs = new PlayerAudioInputs(sources);
	const selection = { type: 'player', playerId: 'player' };
	const first = inputs.resolve(selection);
	const revision = history.revision;
	append(history, 2, [3, 4]);
	assert.equal(history.revision, revision);
	const appended = inputs.resolve(selection);
	assert.notEqual(appended.cacheKey, first.cacheKey);
	assert.deepEqual(appended.readWindow(0.002, signal()).channels[0], Float32Array.of(3, 4));
	const replacement = new AudioHistory();
	append(replacement, 0, [5, 6, 7, 8]);
	assert.equal(replacement.revision, history.revision);
	assert.equal(replacement.endFrame, history.endFrame);
	sources.set(playerAudioSourceId('player'), replacement);
	const replaced = inputs.resolve(selection);
	assert.notEqual(replaced.cacheKey, appended.cacheKey);
	assert.deepEqual(replaced.readWindow(0.002, signal()).channels[0], Float32Array.of(7, 8));
	replacement.reset();
	const reset = inputs.resolve(selection);
	assert.notEqual(reset.cacheKey, replaced.cacheKey);
	assert.deepEqual(reset.readWindow(0.002, signal()).channels[0], Float32Array.of(0, 0));
	assert.deepEqual(first.readWindow(0.002, signal()).channels[0], Float32Array.of(1, 2));
	sources.clear();
	assert.equal(inputs.resolve(selection), null);
	assert.equal(inputs.resolve(null), null);
	assert.throws(() => inputs.resolve({ type: 'layer', layerId: 'layer' }), /Invalid player audio source/);
});

// 【音声公開パラメータは専用入力として渡し、PARAM式には公開しない】
// 下層入力の解決をVisual Moduleの外側に保ち、内部エフェクトはSceneやレイヤーを知らずに使える。
// canNodeを無効にしても、音声リソースを通常の数値・画像の参照へ流してはいけない。
test('resolves public audio inputs independently of PARAM and image parameters', () => {
	const renderer = createVisualModuleRenderer(VisualModuleRenderer);
	const publicAudio = { ...audioDef, id: 'audio-id', nameForReference: 'Sound' };
	const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Number', control: { controlType: 'number' } }, defaultValue: literal(0) };
	const source = { cacheKey: 'lower', readWindow: () => window() };
	const node = { id: 'node', type: 'effect', effectId: 'probe', params: { audio: { inputSource: 'externalCustomParameterInput', parameterId: publicAudio.id }, amount: { inputSource: 'expression', expression: 'PARAM("Sound")' } } };
	Object.assign(renderer, { nodes: [node], paramDefs: [publicAudio], effectDefinitions: { probe: { paramDefs: { audio: audioDef, amount: scalar } } } });
	const context = { time: 50, endTime: 100, isExport: false, evaluatedParamValues: new Map([[publicAudio.id, 123]]), audioParamInputs: new Map([[publicAudio.id, source]]) };
	renderer.evaluateParameters(context);
	const params = renderer.resolveParams(node, renderer.evaledNodeParams.get(node.id));
	assert.equal(params.audio, source);
	assert.equal(params.amount, 0);
	assert.throws(() => {
		node.params.amount = { inputSource: 'externalCustomParameterInput', parameterId: publicAudio.id };
		renderer.evaluateParameters(context);
	}, /audio parameter/);
	renderer.destroy();
});

// 【LIVEでは音声の静的なPlayer指定を解決し、式による切り替えを拒否する】
// 値評価器へ渡す前に検証することで、式がPlayer IDを返して音声配線を動的に変更する抜け道を防ぐ。
test('resolves live player selections and rejects dynamic audio bindings', () => {
	const history = new AudioHistory();
	history.append({ generation: 1, startFrame: 0, sampleRate: 1000, channelCount: 1, frameCount: 2, buffer: Float32Array.from([1, -1]).buffer });
	const inputs = new PlayerAudioInputs(new Map([[playerAudioSourceId('player'), history]]));
	const renderer = createVisualModuleRenderer(VisualModuleRenderer, { resolveAudioSource: selection => inputs.resolve(selection) });
	const node = { id: 'node', type: 'effect', effectId: 'probe', params: { audio: literal({ type: 'player', playerId: 'player' }) } };
	Object.assign(renderer, { nodes: [node], effectDefinitions: { probe: { paramDefs: { audio: audioDef } } } });
	const context = { time: 0, endTime: Infinity, isExport: false, evaluatedParamValues: new Map() };
	renderer.evaluateParameters(context);
	const input = renderer.resolveParams(node, renderer.evaledNodeParams.get(node.id)).audio;
	assert.deepEqual(input.readWindow(0.002, signal()).channels[0], Float32Array.from([1, -1]));
	for (const binding of [{ inputSource: 'expression', expression: 'null' }, { inputSource: 'node', nodeId: null, outputPort: null }]) {
		node.params.audio = binding;
		assert.throws(() => renderer.evaluateParameters(context), /static input/);
	}
	renderer.destroy();
});

// 【Visual Moduleは呼び出し側の取得元指定を解釈せずに渡す】
// Player以外の利用ドメインを追加しても、共通型やVisual Moduleへ選択肢を増やす必要がない。
test('delegates literal audio selections without knowing their source domain', () => {
	const selection = { source: 'test-recording' };
	const input = { cacheKey: 'recording', readWindow: () => window() };
	const renderer = createVisualModuleRenderer(VisualModuleRenderer, { resolveAudioSource: value => {
		assert.equal(value, selection);
		return input;
	} });
	const node = { id: 'node', type: 'effect', effectId: 'probe', params: { audio: literal(selection) } };
	Object.assign(renderer, { nodes: [node], effectDefinitions: { probe: { paramDefs: { audio: audioDef } } } });
	renderer.evaluateParameters({ time: 0, endTime: Infinity, isExport: false, evaluatedParamValues: new Map() });
	assert.equal(renderer.resolveParams(node, renderer.evaledNodeParams.get(node.id)).audio, input);
	renderer.destroy();
});

// 【Visual Moduleの主音声入力はScene時刻で解決し、内容時刻と分離する】
// トリムやモジュール内のTIMEを変えても、同じ場所の下層音声が選ばれる必要がある。
// Noneを明示した場合は自動割り当てを上書きし、音声の読み出しも行わない。
test('anchors module audio to scene time while preserving content time and explicit none', async () => {
	const publicAudio = { ...audioDef, id: 'audio-id', nameForReference: 'Sound' };
	const visualModule = { paramDefs: [publicAudio], primaryInputId: null, primaryAudioInputId: publicAudio.id };
	const layer = { visualModuleParamValues: {}, automationGraphs: [] };
	const calls = [];
	const input = { cacheKey: 'lower', readWindow: () => window() };
	let prepared;
	const renderer = createVisualModuleTimelineLayer(visualModule, layer, {
		getAudioInput: (...args) => { calls.push(args); return input; },
		prepare: async context => { prepared = context; }, render: context => { assert.equal(context, prepared); return { gpuTime: 0 }; }, destroy() {},
	});
	const context = { input: { kind: 'uniform', value: [0, 0, 0, 0] }, sceneTimeMs: 600.25, contentTimeMs: 120.25, contentEndTimeMs: 500,
		clipElapsedTimeMs: 100, clipDurationMs: 400, timeDelta: 0, isExport: true };
	await renderer.evaluate(context, signal());
	assert.deepEqual(calls, [[600.25, true]]);
	assert.equal(prepared.time, 120.25);
	assert.equal(prepared.audioParamInputs.get(publicAudio.id), input);
	assert.equal(prepared.evaluatedParamValues.has(publicAudio.id), false);
	layer.visualModuleParamValues[publicAudio.id] = literal(null);
	await renderer.evaluate(context, signal());
	assert.equal(prepared.audioParamInputs.get(publicAudio.id), null);
	assert.equal(calls.length, 1);
});

// 【波形は短いピークを保持し、未選択と無音を区別する】
// GPUへ渡すmin/maxを実エフェクトで検証し、入力変換後にも正規化せず振幅と左右の値を保つ。
// ピクセル描画はブラウザを使わず、既存シェーダーへ渡すデータと色のalphaを確認する。
test('uploads stereo peaks and distinguishes silence from no source', () => {
	globalThis.GPUBufferUsage = { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 };
	const writes = [];
	const device = { createShaderModule: () => ({}), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBuffer: () => ({ destroy() {} }), createBindGroup: () => ({}),
		queue: { writeBuffer: (_buffer, _offset, data) => writes.push([...data]) } };
	const instance = waveform.init({ wgpu: { device }, resolution: { width: 2, height: 2 }, reportStatus() {} });
	const params = { ...Object.fromEntries(Object.entries(waveformDefinition.paramDefs).map(([key, def]) => [key, def.defaultValue.value])),
		channel: 'stereo', colorL: [1, 0, 0, 0.5], audio: { cacheKey: 'peaks', readWindow: () => window([0, 3, -2, 0], [1, -1, 2, -3]) } };
	const draw = () => instance.render({ params, outputDataMap: { output: { textureView: {} } }, createPassEncoderFor: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) });
	draw();
	assert.deepEqual(writes.at(-1), [0, 3, -1, 1, -2, 0, -3, 2]);
	assert.equal(writes.at(-2)[3], 0.5);
	assert.equal(writes.at(-2)[12], 1);
	params.audio = { cacheKey: 'silence', readWindow: () => window([0, 0]) };
	draw();
	assert.equal(writes.at(-2)[12], 1);
	params.audio = null;
	draw();
	assert.equal(writes.at(-2)[12], 0);
	instance.dispose();
});
