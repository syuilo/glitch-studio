import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
import { gpuFixture } from './helpers/manager-gpu.mjs';

const globals = ['GPUQueue', 'GPUTextureUsage', 'GPUBufferUsage', 'GPUShaderStage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
globalThis.GPUQueue = class { submit() {} };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
after(() => { for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
const { EffectLivePreviewManager } = await loadShaderSource(fileURLToPath(new URL('../src/effect-live-preview-manager.ts', import.meta.url)));
const literal = value => ({ inputSource: 'literal', value });
const definition = { kind: 'generate', primaryInputParameter: null, primaryOutput: 'color', resolutionInputParameters: [],
	paramDefs: { value: { dataType: { kind: 'scalar' }, defaultValue: literal(0), ui: { label: 'Value', control: {} } } },
	outputDefs: { scalar: { dataType: { kind: 'scalar' }, nameForReference: 'gray' }, color: { dataType: { kind: 'color' }, nameForReference: 'color' } } };
const shader = { ...definition, paramDefs: {}, code: 'fn main(p: vec2f) -> Output { return Output(1., vec4f(1.)); }', shaderApiVersion: 1 };
const reference = { type: 'customShaderEffectReference', id: 'shared' };
const graph = source => ({ ...definition, nodes: [{ id: 'child', effectSource: source, params: {} }],
	outputSources: { scalar: { nodeId: 'child', outputPort: 'scalar' }, color: { nodeId: 'child', outputPort: 'color' } } });

async function fixture(t, implementation) {
	const { device, texture } = gpuFixture();
	const submitted = [];
	const errors = [];
	let frame;
	const manager = await EffectLivePreviewManager.create({
		gpuDevice: device, canvasOutput: { format: 'rgba8unorm', colorSpace: 'srgb' }, gpuContext: { canvas: { width: 2, height: 1 }, configure() {}, getCurrentTexture: texture },
		frameScheduler: { now: () => 0, requestFrame(callback) { frame = callback; return 1; }, cancelFrame() {} },
		nativeEffectDefinitions: { shared: definition }, nativeEffectImplementations: { shared: implementation },
	}, { enable32bitDataTextures: false, effectRenderTiling: { mode: 'disabled' }, enableStats: false, enableWaveformAndHistogram: false }, { assets: [], players: [] });
	t.after(() => manager.destroy());
	manager.on('ev', event => { if (event.type === 'renderError') errors.push(event.ctx.message); });
	manager.updateDynamicOptions({ resolution: { width: 5, height: 3 },
		customShaderEffects: [{ id: 'shared', name: 'Shader', summary: '', definition: shader }],
		customNodeGraphEffects: [{ id: 'shared', name: 'Graph', definition: graph(reference) }] });
	manager.canvasRenderer.renderToCanvas = (texture, _encoder, time) => submitted.push({ texture, time });
	return { manager, submitted, errors, async frame(time) { frame(time); await new Promise(resolve => setImmediate(resolve)); } };
}

// 【全5種類のEffectSourceを同じWorker用Managerから描画する】
// 名前空間に同じIDを持つ登録があっても指定した種類・ポートだけを計画し、データ出力を元のチャンネル形式で表示する。
test('previews every source kind with a fixed output port and native channel format', async t => {
	const ports = [];
	const f = await fixture(t, { init({ outputTextures }) { ports.push([...outputTextures.keys()]); return { render() {}, dispose() {} }; } });
	for (const effectSource of [{ type: 'nativeEffect', id: 'shared' }, reference, { type: 'inlineCustomShaderEffect', customShaderEffect: shader },
		{ type: 'customNodeGraphEffectReference', id: 'shared' }, { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph(reference) }]) {
		f.manager.startEffectLivePreview({ effectSource, outputPort: 'scalar' }, 'instance');
		await f.frame(25);
		assert.deepEqual(f.errors, []);
		assert.equal(f.submitted.at(-1).texture.format, 'r16float');
	}
	assert.equal(f.submitted.length, 5);
	assert.deepEqual(ports, [['scalar']]);
	f.manager.startEffectLivePreview({ effectSource: reference }, 'instance');
	await f.frame(25);
	assert.equal(f.submitted.at(-1).texture.format, 'rgba16float');
});

// 【公開パラメータの値編集は履歴を保持し、参照先の定義編集はその配置を再生成する】
// 別種類の同名登録を編集しても進行中のNative Effectの履歴に影響を与えないことも確認する。
test('preserves history for parameter edits and rebuilds only transitive dependants', async t => {
	const values = [];
	let disposals = 0;
	const f = await fixture(t, { init({ inputs }) { return { render() { values.push(inputs.value.value); }, dispose() { disposals++; } }; } });
	f.manager.startEffectLivePreview({ effectSource: { type: 'nativeEffect', id: 'shared' }, params: { value: literal(3) } }, 'id');
	await f.frame(10);
	f.manager.updateEffectLivePreviewParamValues({ value: literal(7) });
	f.manager.applyProjectChanges([{ type: 'customShaderEffectRegistration', customShaderEffectId: 'other', customShaderEffect: null }]);
	await f.frame(20);
	assert.deepEqual(values, [3, 7]);
	assert.equal(disposals, 0);
	f.manager.startEffectLivePreview({ effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph({ type: 'customNodeGraphEffectReference', id: 'shared' }) } }, 'id');
	await f.frame(30);
	const before = f.submitted.at(-1).texture;
	f.manager.applyProjectChanges([{ type: 'customShaderEffectRegistration', customShaderEffectId: 'shared',
		customShaderEffect: { id: 'shared', name: 'Edited', summary: '', definition: { ...shader, code: shader.code + ' ' } } }]);
	await f.frame(40);
	assert.notEqual(f.submitted.at(-1).texture, before);
	assert.deepEqual(f.errors, []);
});

// 【定義一覧の再同期は無関係な配置の履歴を維持し、初期化失敗から同じ選択で復帰する】
// Workerをまたぐと定義の参照同一性は失われる。複製された一覧や別の登録変更でも
// 表示中の配置を維持し、編集中の定義が再び有効になったら次のフレームへ反映する。
test('preserves unrelated history on snapshot sync and resumes a corrected definition', async t => {
	let disposed = 0;
	const f = await fixture(t, { init() { return { render() {}, dispose() { disposed++; } }; } });
	const graphSource = { type: 'customNodeGraphEffectReference', id: 'shared' };
	const registered = { id: 'shared', name: 'Graph', definition: graph({ type: 'nativeEffect', id: 'shared' }) };
	f.manager.updateDynamicOptions({ customNodeGraphEffects: [registered] });
	f.manager.startEffectLivePreview({ effectSource: graphSource });
	await f.frame(10);
	f.manager.updateDynamicOptions({ customNodeGraphEffects: [structuredClone(registered), { ...registered, id: 'other' }] });
	await f.frame(20);
	assert.equal(disposed, 0);
	const broken = { ...registered, definition: graph({ type: 'nativeEffect', id: 'missing' }) };
	f.manager.updateDynamicOptions({ customNodeGraphEffects: [broken] });
	await f.frame(30);
	assert.equal(disposed, 1);
	assert.match(f.errors[0], /Unknown Native Effect/);
	f.manager.updateDynamicOptions({ customNodeGraphEffects: [registered] });
	await f.frame(40);
	assert.equal(f.errors.length, 1);
	assert.equal(f.submitted.at(-1).time, 40);
});
