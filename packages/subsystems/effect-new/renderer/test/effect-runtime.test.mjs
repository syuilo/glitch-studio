import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEffectInstance } from '../src/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';

const size = { width: 32, height: 16 };
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: {} }, defaultValue: literal(0) };
const native = { type: 'nativeEffect', id: 'test' };
const inline = customNodeGraphEffect => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect });
const definition = { kind: 'generate', primaryInputParameter: null, primaryOutput: 'image', paramDefs: {},
	outputDefs: { image: { dataType: { kind: 'color' } } }, resolutionInputParameters: [] };
const output = { nodeId: 'draw', outputPort: 'image' };
const frame = (time = 1) => ({ time, timeDelta: 40, endTime: 4, pointerPosition: [0.25, 0.125], pointerVector: [0.1, 0.1] });
function create(effectSource, def, init, options = {}) {
	return createEffectInstance({ effectSource, definitions: { getNativeEffect: () => def }, resolution: size,
		usedOutputPorts: new Set(['image']), ...options }, {}, () => ({ createOutputTexture() { return { destroy() {} }; }, init }));
}

// 【入れ子の配置で公開値・内部の共有値・Automation Graph・キーを同じフレームで評価する】
// 親子で同じ名前の値があっても、引数は親、ノードの式は子のスコープに属する。共有値の未使用の循環は実行しない。
test('evaluates nested public and custom scopes, modifiers, automation and keyframes', async () => {
	const play = { trimmedDurationMs: null, offsetMode: 'start', wrapMode: 'clamp' };
	const def = { ...definition, paramDefs: { result: scalar, gain: scalar, aspect: scalar, pointer: scalar } };
	const graph = { ...definition, paramDefs: { x: { ...scalar, nameForReference: 'amount' } },
		customParameterDefs: { c: { ...scalar, nameForReference: 'shared' }, unused: { ...scalar, nameForReference: 'cycle' } },
		customParameterValues: { c: expression('PUBLIC("amount") + GRAPH("constant", 0, "clamp")'), unused: expression('CUSTOM("cycle")') },
		automationGraphs: [{ id: 'g', nameForReference: 'constant', isNormalized: false, points: [{ x: 0, y: 3 }] }],
		nodes: [{ id: 'draw', effectSource: native, resolution: { width: 16, height: 16 }, params: {
			result: { ...expression('CUSTOM("shared")'), expressionModifier: { enabled: true, code: 'VALUE * 2' } },
			gain: { inputSource: 'automationGraphReference', automationGraphId: 'g', ...play },
			aspect: { inputSource: 'envVariable', variable: 'ASPECT_RATIO' }, pointer: expression('POINTER_POSITION[1]'),
		} }], outputSources: { image: output } };
	const parent = { ...definition, nodes: [{ id: 'child', effectSource: inline(graph), params: { x: {
		inputSource: 'keyframesTimelineInline', ...play, keyframesTimeline: { dataType: scalar.dataType, isNormalized: false, keyframes: [
			{ id: 'a', x: 0, value: 2, interpolation: { type: 'linear' } }, { id: 'b', x: 2000, value: 6, interpolation: { type: 'hold' } },
		] },
	} } }, { id: 'wire', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: 'child', outputPort: 'image' } }],
		outputSources: { image: { nodeId: 'wire', outputPort: 'output' } } };
	validateEffectSource(inline(parent), { getNativeEffect: () => def });
	const values = [];
	const instance = await create(inline(parent), def, ({ inputs }) => ({
		render(ctx) { values.push([inputs.result.value, inputs.gain.value, inputs.aspect.value, inputs.pointer.value, ctx.pointerPosition]); }, dispose() {},
	}));
	instance.render(frame(1));
	instance.render(frame(2));
	assert.deepEqual(values, [[14, 3, 1, 0.25, [0.25, 0.25]], [18, 3, 1, 0.25, [0.25, 0.25]]]);
	instance.dispose();
	graph.nodes[0].params.result = { inputSource: 'customNodeGraphEffectCustomParameterValueReference', parameterId: 'unused' };
	const cyclic = await create(inline(parent), def, () => ({ render() {}, dispose() {} }));
	assert.throws(() => cyclic.render(frame()), /Circular custom parameter reference/);
	cyclic.dispose();
});

// 【公開入力からRelayを通る配線は、外部入力の種類と値をそのまま渡す】
// InからOutへ直接つないだ場合と同じく、Relay自身はGPUリソースや描画処理を必要としない。
test('passes both uniform and texture public inputs through a relay', async () => {
	const graph = { ...definition, paramDefs: { gain: { ...scalar, canNode: true } },
		nodes: [{ id: 'wire', type: 'relay', dataType: { kind: 'scalar' }, input: { parameterId: 'gain' } }],
		outputDefs: { image: { dataType: { kind: 'scalar' } } }, outputSources: { image: { nodeId: 'wire', outputPort: 'output' } } };
	validateEffectSource(inline(graph), {});
	for (const input of [{ kind: 'uniform', value: 0.5 }, { kind: 'texture', texture: {}, resolution: size }]) {
		const instance = await create(inline(graph), definition, () => assert.fail('Unexpected Native Effect'), { inputs: { gain: input } });
		instance.render(frame());
		const result = instance.outputs.get('image');
		assert.equal(result.kind, input.kind);
		if (input.kind === 'texture') assert.equal(result.texture, input.texture);
		else assert.equal(result.value, input.value);
		instance.dispose();
	}
});

// 【保存した型不一致の配線でも入力種別と値を維持する】
// scalarの公開入力からvectorのRelayとcolorの入力・公開出力につないでも、
// 配置が選んだuniform・textureの束縛でそのまま描画する。Relayや型の違いで書き換えや再確保が起きると失敗する。
test('loads mismatched ports and draws with the original fixed shader inputs', async () => {
	const color = { ...scalar, canNode: true, dataType: { kind: 'color' }, defaultValue: literal([0, 0, 0, 0]) };
	const consumer = { ...definition, paramDefs: { wired: color, direct: color } };
	const graph = inline({ ...definition, paramDefs: { gain: { ...scalar, canNode: true } },
		nodes: [
			{ id: 'wire', type: 'relay', dataType: { kind: 'vector' }, input: { parameterId: 'gain' } },
			{ id: 'draw', effectSource: native, params: {
				wired: { inputSource: 'node', source: { nodeId: 'wire', outputPort: 'output' }, sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' } },
				direct: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'gain' },
			} },
		], outputDefs: { ...definition.outputDefs, relay: { dataType: { kind: 'color' } } },
		outputSources: { image: output, relay: { nodeId: 'wire', outputPort: 'output' } },
	});
	validateEffectSource(graph, { getNativeEffect: () => consumer });
	const value = [0.5];
	const texture = {};
	for (const input of [{ kind: 'uniform', value }, { kind: 'texture', texture, resolution: size }]) {
		let draws = 0;
		const instance = await create(graph, consumer, ({ inputs }) => {
			for (const binding of [inputs.wired, inputs.direct]) assert.equal(binding.kind, input.kind);
			return { render() {
				for (const binding of [inputs.wired, inputs.direct]) {
					if (input.kind === 'texture') assert.equal(binding.texture, texture);
					else assert.equal(binding.value, value);
				}
				draws++;
			}, dispose() {} };
		}, { inputs: { gain: input }, usedOutputPorts: new Set(['image', 'relay']) });
		try {
			instance.render(frame(1));
			instance.render(frame(2));
			assert.equal(instance.outputs.get('relay').kind, input.kind);
			assert.equal(draws, 2);
		} finally {
			instance.dispose();
		}
	}
});

// 【原寸と倍率を一度だけ適用し、画像・ファイル・Playerを借用し、音声をフレーム単位で解決する】
// 素材や音声を所有する呼び出し側が同じGPU画像の内容を更新しても、配置の再生成は不要。
test('resolves borrowed resources, audio and scaled intrinsic dimensions', async () => {
	const audio = { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, defaultValue: literal(null) };
	const setting = (dataType, defaultValue) => ({ dataType, defaultValue, ui: { label: 'Resource' } });
	const def = { ...definition, paramDefs: { audio }, intrinsicResolutionSetting: 'image', staticSettingDefs: {
		image: setting({ kind: 'assetReference', assetType: 'image' }, 'i'), font: setting({ kind: 'assetReference', assetType: 'font' }, 'f'),
		player: setting({ kind: 'playerReference' }, 'p'),
	} };
	const texture = {};
	const font = new Blob();
	let video = null;
	let reads = 0;
	let renders = 0;
	const draw = await create(native, def, ({ inputs, resolution, resources }) => {
		assert.deepEqual(resolution, { width: 30, height: 15 });
		assert.equal(resources.image, texture);
		assert.equal(resources.font, font);
		return { render(ctx) { renders++; assert.equal(resources.player.getVideoTexture(), video); assert.equal(inputs.audio.value.endFrame, ctx.time); }, dispose() {} };
	}, { resolutionSetting: { mode: 'auto', scale: 1.5 }, resolutionScale: 0.5, params: { audio: literal('sound') },
		resources: { assets: [{ id: 'i', width: 40, height: 20, fileData: new Blob(), fileDataType: 'image/png' },
			{ id: 'f', fileData: font, fileDataType: 'font/ttf' }], assetTextures: new Map([['i', texture]]), getPlayerVideoTexture: () => video },
		resolveAudioSource(id, ctx) { reads++; assert.equal(id, 'sound'); return { endFrame: ctx.time }; },
	});
	const first = frame();
	await draw.prepare(first);
	draw.render(first, {});
	video = { texture };
	draw.render(frame(2));
	assert.equal(reads, 2);
	assert.equal(renders, 2);
	draw.dispose();
});

// 【新しい準備・中断・破棄が古いフレームの完了通知やGPU資源の早期破棄を防ぐ】
// 音声等の読み出しがキャンセルの直後に完了する場合も、旧フレームが描画可能になってはならない。
test('supersedes preparation, shares a ready frame and drains work before disposal', async () => {
	const requests = [], statuses = [];
	let draws = 0, released = 0;
	const instance = await create(native, definition, () => ({
		prepare(ctx, signal) { const task = Promise.withResolvers(); requests.push({ ...task, signal }); return task.promise; },
		render() { draws++; }, dispose() { released++; },
	}), { onPreparationStatus: status => statuses.push(status.type) });
	const a = frame(1), b = frame(2);
	assert.equal(instance.tryPrepare(a), false);
	const waiting = instance.prepare(a);
	assert.equal(instance.tryPrepare(b), false);
	await assert.rejects(waiting, { name: 'AbortError' });
	const ready = instance.prepare(b);
	requests[1].resolve();
	await ready;
	instance.render(b, {});
	assert.equal(draws, 1);
	assert.equal(requests.length, 2);
	assert.deepEqual(statuses, ['loading', 'loading', 'ready']);
	const c = frame(3);
	const abort = new AbortController();
	const cancelled = instance.prepare(c, abort.signal);
	abort.abort();
	await assert.rejects(cancelled, { name: 'AbortError' });
	instance.dispose();
	assert.equal(released, 0);
	requests[0].resolve(); requests[2].resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(released, 1);
});

// 【外部テクスチャの世代を下流のキャッシュへ伝え、世代不明の画像は毎回描画する】
// 同じリソースを更新する入力と、履歴リセットによる無効化の両方を取りこぼさない。
test('propagates input versions and invalidates cached outputs on reset', async () => {
	const def = { ...definition, paramDefs: { image: { ...scalar, canNode: true } } };
	const sampling = { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' };
	const graph = { ...def, nodes: [{ id: 'a', effectSource: native, params: { image: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'image' } } },
		{ id: 'draw', effectSource: native, params: { image: { inputSource: 'node', source: { nodeId: 'a', outputPort: 'image' }, sampling } } }], outputSources: { image: output } };
	let version = 0, draws = 0;
	const instance = await create(inline(graph), def, () => ({ cacheKey: 0, render() { draws++; }, dispose() {} }), {
		inputs: { image: { kind: 'texture', resolution: size, texture: {}, get version() { return version; } } },
	});
	instance.render(frame()); instance.render(frame()); assert.equal(draws, 2);
	version++; instance.render(frame()); assert.equal(draws, 4);
	instance.resetRenderHistory(); instance.render(frame()); assert.equal(draws, 6);
	version = undefined; instance.render(frame()); instance.render(frame()); assert.equal(draws, 10);
	instance.dispose();
});

// 【Shaderの入出力契約と未使用Relayの循環をGPU初期化前の編集境界で診断する】
// 未完成のWGSL本文は保存できるが、生成する識別子・解像度指定・配線の参照先は確定している必要がある。
test('validates shader interfaces and unused relay cycles without a GPU', () => {
	const parameter = { ...scalar, canNode: true, nameForReference: 'gain' };
	const shader = { ...definition, shaderApiVersion: 1, code: 'unfinished', paramDefs: { x: parameter },
		outputDefs: { image: { dataType: { kind: 'color' }, nameForReference: 'image' } } };
	const validate = customShaderEffect => validateEffectSource({ type: 'inlineCustomShaderEffect', customShaderEffect }, {});
	validate(shader);
	const section = { type: 'section', id: 'inputs', label: 'Inputs', children: ['x'] };
	validate({ ...shader, ui: { parameterLayout: [section] } });
	assert.throws(() => validate({ ...shader, ui: { parameterLayout: [] } }), /Missing layout parameters/);
	assert.throws(() => validate({ ...shader, ui: { parameterLayout: [section, 'x'] } }), /duplicate layout parameter/);
	assert.throws(() => validate({ ...shader, ui: { parameterLayout: [section, { ...section, children: [] }] } }), /layout section/);
	assert.throws(() => validate({ ...shader, paramDefs: { x: parameter, y: parameter } }), /duplicateParameter/);
	assert.throws(() => validate({ ...shader, paramDefs: { x: { ...parameter, nameForReference: 'gs_resolution' } } }), /invalidReferenceName/);
	assert.throws(() => validate({ ...shader, resolutionInputParameters: ['missing'] }), /invalidResolutionInput/);
	const custom = { ...scalar, nameForReference: 'gain' };
	assert.throws(() => validateEffectSource(inline({ ...definition, nodes: [], outputSources: {},
		customParameterDefs: { gain: custom }, customParameterValues: { gain: { inputSource: 'customNodeGraphEffectCustomParameterValueReference', parameterId: 'gain' } },
	}), {}), /Circular custom parameter reference/);
	assert.throws(() => validateEffectSource(inline({ ...definition, nodes: [
		{ id: 'self', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: 'self', outputPort: 'output' } },
	], outputSources: {} }), {}), /Cyclic node connection/);
});

// 【準備に失敗したフレームを描画せず、別フレームは新しい準備で回復する】
// 過去の読み込み失敗を次の配置状態へ持ち越したり、同じフレームを再評価して失敗理由を隠したりしない。
test('preserves preparation errors and recovers on the next frame', async () => {
	const problem = new Error('resource unavailable');
	let renders = 0;
	const instance = await create(native, definition, () => ({
		prepare(ctx) { if (ctx.time === 0) return Promise.reject(problem); },
		render() { renders++; }, dispose() {},
	}));
	const failed = frame(0);
	await assert.rejects(instance.prepare(failed), error => error === problem);
	assert.equal(instance.preparationStatus.error, problem);
	assert.throws(() => instance.render(failed), error => error === problem);
	instance.render(frame(1));
	assert.equal(renders, 1);
	instance.dispose();
});

// 【Compute Passの番号は通常描画とタイル描画で一致し、転送コマンドを数えない】
// 同じNative Effectが途中にバッファ操作を挟んでも、統計を元のCompute Passへ対応付けられるようにする。
test('reports consecutive compute pass indices across intervening encoder commands', async () => {
	const reports = [], commands = [];
	const device = {
		features: new Set(), queue: { submit() {}, async onSubmittedWorkDone() {} },
		createCommandEncoder: () => ({
			insertDebugMarker() { commands.push('marker'); },
			beginComputePass() { return { end() { commands.push('compute'); } }; }, finish() { return {}; },
		}),
	};
	const instance = await createEffectInstance({
		effectSource: native, definitions: { getNativeEffect: () => definition }, resolution: size, usedOutputPorts: new Set(['image']),
		tiling: { mode: 'manual', tileSize: 2 }, onGpuTime: (_path, index, time) => reports.push([index, time]),
	}, { device }, () => ({
		createOutputTexture: () => ({ destroy() {} }),
		init: () => ({ render({ commandEncoder }) {
			for (let i = 0; i < 2; i++) {
				commandEncoder.insertDebugMarker('before pass');
				commandEncoder.beginComputePass().end();
			}
		}, dispose() {} }),
	}));
	try {
		instance.render(frame(), device.createCommandEncoder());
		await instance.renderTiled(frame());
		assert.deepEqual(commands, ['marker', 'compute', 'marker', 'compute', 'marker', 'compute', 'marker', 'compute']);
		assert.deepEqual(reports, [[0, null], [1, null], [0, null], [1, null]]);
	} finally { instance.dispose(); }
});
