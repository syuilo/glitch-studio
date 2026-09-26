import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// GPUの実行だけを置き換え、MainRenderer・ノード評価・描画ループは実コードを使う。
const globals = ['GPUQueue', 'GPUTextureUsage', 'GPUBufferUsage', 'GPUShaderStage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const gpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
globalThis.GPUQueue = class { submit() {} };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
Object.defineProperty(navigator, 'gpu', { configurable: true, value: { getPreferredCanvasFormat: () => 'rgba8unorm' } });
after(() => {
	for (const [key, descriptor] of globals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	if (gpu) Object.defineProperty(navigator, 'gpu', gpu);
	else delete navigator.gpu;
});
const { MainRenderer } = await loadShaderSource(fileURLToPath(new URL('../src/renderer.ts', import.meta.url)));

function visualModule(circular) {
	return {
		id: 'module', name: 'Test', automationGraphs: [],
		paramDefs: [],
		outputDefs: [{ id: 'output', isPrimaryOutput: true, dataType: { kind: 'color' } }],
		nodes: [
			{ id: 'a', type: 'effect', effectId: 'pass', isBypass: true, params: { input: { inputSource: 'node', nodeId: circular ? 'b' : null, outputPort: 'output' } } },
			{ id: 'b', type: 'effect', effectId: 'pass', isBypass: true, params: { input: { inputSource: 'node', nodeId: 'a', outputPort: 'output' } } },
			{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'a', outputPort: 'output' } } },
		],
	};
}

function fixture(t) {
	const errors = [];
	const frames = new Map();
	let frameId = 0;
	const texture = ({ size = [1, 1], format = 'rgba8unorm' } = {}) => ({
		width: size[0], height: size[1], depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1,
		format, dimension: '2d', createView: () => ({}), destroy() {},
	});
	const device = {
		features: new Set(), lost: new Promise(() => {}), destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() {} }),
		createShaderModule: () => ({}), createSampler: () => ({}), createBindGroup: () => ({}),
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) }),
		queue: { submit() {}, writeBuffer() {}, writeTexture() {} },
	};
	const renderer = new MainRenderer({
		gpuDevice: device, gpuContext: { configure() {}, getCurrentTexture: texture },
		resolution: { width: 1, height: 1 }, enableStats: false, enable32bitDataTextures: false,
		intermediateTextureFormat: 'rgba8unorm', fpsLimit: null,
		frameScheduler: { now: () => 0, requestFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelFrame: id => frames.delete(id) },
		onPreviewError: message => errors.push(message),
		visualModules: [visualModule(true)],
		timeline: [{ id: 'layer', layerType: 'visualModule', visualModuleId: 'module', startTimeMs: 0, endTimeMs: 1000, paramValues: {}, automationGraphs: [] }],
		effectDefinitions: { pass: { primaryInputParameter: 'input', outputDefs: { output: { dataType: { kind: 'color' } } }, paramDefs: {
			input: { dataType: { kind: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		} } },
		effectImplementations: { pass: { outputTextureFactories: {} } },
	});
	t.after(() => renderer.destroy());
	return { renderer, errors, frames, frame(timestamp) {
		const [id, callback] = frames.entries().next().value;
		frames.delete(id);
		callback(timestamp);
	} };
}

// LIVEの循環参照を修正すると、再初期化せず次のフレームで復旧する。
// エラー文字列をthrowするだけのスタブでは、実際のノード評価が修正後のグラフを読む保証にならない。
// 循環した二つのノードの配線を外し、例外がRAFから漏れずループも失われないことを確認する。
test('recovers live rendering after repairing a circular graph', t => {
	const { renderer, errors, frames, frame } = fixture(t);
	renderer.startLiveRenderLoopFor('module');
	assert.doesNotThrow(() => frame(16));
	assert.equal(errors.at(-1), 'circular dependency detected');
	assert.equal(frames.size, 1);
	renderer.updateVisualModules([visualModule(false)]);
	assert.doesNotThrow(() => frame(32));
	assert.equal(errors.at(-1), null);
	assert.equal(frames.size, 1);
});

// 停止中のタイムラインも、循環参照を修正して再描画すると復旧する。
// LIVEのRAFだけを保護しても、非同期のprepareで失敗するタイムラインのシークは救えない。
// 同じ位置で再描画でき、前回のエラーが成功後に解除されることを保証する。
test('recovers timeline preview after repairing a circular graph', async t => {
	const { renderer, errors } = fixture(t);
	await renderer.renderTimelineAt(0);
	assert.equal(errors.at(-1), 'circular dependency detected');
	renderer.updateVisualModules([visualModule(false)]);
	await renderer.renderTimelineAt(0);
	assert.equal(errors.at(-1), null);
});

// 書き出しの描画エラーはプレビューのように握りつぶさず、呼び出し元へ返す。
// 動画出力で失敗を成功扱いすると欠落したフレームを含むファイルを生成してしまうため、
// 今回の復旧用catchをエクスポート経路に広げないことを保証する。
test('still rejects export frames for invalid graphs', async t => {
	const { renderer, errors } = fixture(t);
	await assert.rejects(renderer.renderTimelineFrame(0, 0), /circular dependency detected/);
	assert.deepEqual(errors, []);
});

// 中断済みシークの完了が、新しいシークやLIVEのエラーを消さない。
// prepareの待機中にモードや再生位置を切り替えると、古いPromiseが後から完了する。
// 完了順だけでfooterを更新すると、現在の描画は失敗しているのにエラーが見えなくなる。
test('ignores obsolete timeline completions after seeking or switching to live', async t => {
	const { renderer, errors, frame } = fixture(t);
	const pending = [];
	renderer.timelineRenderer.renderAt = () => new Promise(resolve => pending.push(resolve));
	const first = renderer.renderTimelineAt(0);
	const second = renderer.renderTimelineAt(10);
	renderer.startLiveRenderLoopFor('module');
	frame(16);
	pending[1]();
	pending[0]();
	await Promise.all([first, second]);
	assert.deepEqual(errors, ['circular dependency detected']);
});

// 古いシークの成功・失敗のどちらも、新しいシークの結果を上書きしない。
// 正常終了の順序だけでなく失敗の順序も逆転し得るため、両方を確認する。
// 新しい位置のエラーを消すことも、修正後に古いエラーを再表示することも防ぐ。
test('keeps the latest seek result when older requests settle later', async t => {
	const { renderer, errors } = fixture(t);
	const pending = [];
	renderer.timelineRenderer.renderAt = () => {
		const gate = Promise.withResolvers();
		pending.push(gate);
		return gate.promise;
	};
	const first = renderer.renderTimelineAt(0);
	const second = renderer.renderTimelineAt(10);
	pending[1].reject(new Error('current failure'));
	await second;
	pending[0].resolve();
	await first;
	assert.deepEqual(errors, ['current failure']);
	const third = renderer.renderTimelineAt(20);
	const fourth = renderer.renderTimelineAt(30);
	pending[3].resolve();
	await fourth;
	pending[2].reject(new Error('obsolete failure'));
	await third;
	assert.deepEqual(errors, ['current failure', null]);
});

// LIVE描画の途中で例外が起きても、GPUコマンドと計測を終了して次のフレームへ進む。
// 循環参照のような描画前の失敗だけを確認すると、計測中の失敗でTimingHelperが
// 前のencoderを保持し続け、原因を直しても描画できなくなる不具合を見逃す。
test('finishes partial live frames before retrying', async t => {
	const { renderer, errors, frame } = fixture(t);
	let submitted = 0;
	let collected = 0;
	renderer.gpuDevice.queue.submit = () => { submitted++; };
	renderer.enableStats = true;
	renderer.timingHelper.getResult = async () => {
		assert.equal(submitted, collected + 1);
		collected++;
		return 0;
	};
	renderer.startLiveRenderLoopFor('module');
	let fail = true;
	renderer.liveVisualModuleRenderer.render = () => {
		if (fail) throw new Error('partial render failed');
		return undefined;
	};
	frame(16);
	assert.equal(errors.at(-1), 'partial render failed');
	assert.equal(collected, 1);
	fail = false;
	frame(32);
	assert.equal(errors.at(-1), null);
	assert.equal(collected, 2);
	await Promise.resolve();
});
