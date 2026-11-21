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
	paramDefs: { value: { dataType: { kind: 'scalar' }, defaultValue: 0, ui: { label: 'Value', control: {} } } },
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
	return { manager, device, submitted, errors, async frame(time) { frame(time); await new Promise(resolve => setImmediate(resolve)); } };
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

// 【選択中の出力を削除すると透明になり、Undoで選択した出力が復帰する】
// ポートの削除は正当な定義変更。別の主出力が残っていても透明を表示し、元のIDが戻るまで選択を保持する。
test('previews a removed output as transparent and resumes it when the definition is restored', async t => {
	const f = await fixture(t);
	const uploads = [];
	f.device.queue.writeTexture = ({ texture }, data) => { uploads.push({ texture, components: Array.from(data) }); };
	const updateShader = definition => f.manager.applyProjectChanges([{
		type: 'customShaderEffectRegistration', customShaderEffectId: reference.id,
		customShaderEffect: { id: reference.id, name: 'Shader', summary: '', definition },
	}]);
	f.manager.startEffectLivePreview({ effectSource: reference, outputPort: 'scalar' });
	await f.frame(20);
	assert.equal(f.submitted.at(-1).texture.format, 'r16float');

	updateShader({ ...shader, outputDefs: { color: shader.outputDefs.color }, code: 'fn main(p: vec2f) -> Output { return Output(vec4f(1.)); }' });
	await f.frame(40);
	const transparent = f.submitted.at(-1).texture;
	assert.equal(transparent.format, 'rgba16float');
	assert.deepEqual([transparent.width, transparent.height], [1, 1]);
	await f.frame(50);
	assert.equal(f.submitted.at(-1).texture, transparent);
	assert.deepEqual(uploads, []);

	updateShader(shader);
	await f.frame(60);
	assert.deepEqual(f.submitted.map(({ texture }) => texture.format), ['r16float', 'rgba16float', 'rgba16float', 'r16float']);
	assert.deepEqual(f.errors, []);
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

// 【定義一覧の再同期は無関係な配置の履歴を維持し、関連定義の変更を反映する】
// Workerをまたぐと定義の参照同一性は失われる。複製された一覧や別の登録変更でも
// 表示中の配置を維持し、検証済みの関連定義が変わったら次のフレームへ反映する。
test('preserves unrelated history on snapshot sync and applies a changed definition', async t => {
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
	const changed = structuredClone(registered);
	changed.definition.nodes[0].params.value = literal(1);
	f.manager.updateDynamicOptions({ customNodeGraphEffects: [changed] });
	await f.frame(30);
	assert.equal(disposed, 1);
	f.manager.updateDynamicOptions({ customNodeGraphEffects: [registered] });
	await f.frame(40);
	assert.deepEqual(f.errors, []);
	assert.equal(f.submitted.at(-1).time, 40);
});

// 【入れ子の登録ノードを初期化中に編集しても、最初の描画に最新値を使う】
// インラインの親の中でGPU初期化を待つ間にも、同じ登録への編集やUndoは到着する。
// ノードの履歴と出力テクスチャを保ったまま、各フレームで最後に確定した値だけを読む。
test('applies nested registration edits received during initialization and preserves subsequent history', async t => {
	const initialization = Promise.withResolvers();
	const values = [];
	let initializations = 0;
	let disposals = 0;
	const f = await fixture(t, { async init({ inputs }) {
		initializations++;
		await initialization.promise;
		let history = 0;
		return { render() { values.push([++history, inputs.value.value]); }, dispose() { disposals++; } };
	} });
	const child = graph({ type: 'nativeEffect', id: 'shared' });
	child.nodes[0].params.value = literal(1);
	f.manager.updateDynamicOptions({ customNodeGraphEffects: [{ id: 'inner', name: 'Inner', definition: child }] });
	f.manager.startEffectLivePreview({ effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph({ type: 'customNodeGraphEffectReference', id: 'inner' }) } });
	const edit = value => f.manager.applyProjectChanges([{ type: 'node', customNodeGraphEffectId: 'inner',
		node: { ...child.nodes[0], params: { value: literal(value) } }, changes: [{ type: 'parameter', kind: 'value' }] }]);
	await f.frame(10);
	edit(2);
	edit(3);
	initialization.resolve();
	await new Promise(resolve => setImmediate(resolve));
	const texture = f.submitted.at(-1).texture;
	edit(1);
	await f.frame(20);
	assert.deepEqual(values, [[1, 3], [2, 1]]);
	assert.equal(initializations, 1);
	assert.equal(disposals, 0);
	assert.equal(f.submitted.at(-1).texture, texture);
	assert.deepEqual(f.errors, []);
});

// 【初期化に失敗した配置は、参照先のノードの値を直すと同じ選択で復帰する】
// GPUの準備を待つ間に編集が先着する場合と、エラーを見てから修正する場合の両方で、
// 新しい定義を使って再開する。無関係な登録の編集は失敗した配置の再試行を起動しない。
test('recovers the selected graph when its node value is corrected during or after failed initialization', async t => {
	for (const editDuringInitialization of [true, false]) {
		const initialization = Promise.withResolvers();
		const initialized = [];
		const rendered = [];
		const f = await fixture(t, { async init({ inputs }) {
			const value = inputs.value.value;
			initialized.push(value);
			if (value === 0) {
				await initialization.promise;
				throw new Error('Invalid initial value');
			}
			return { render() { rendered.push(inputs.value.value); }, dispose() {} };
		} });
		const child = graph({ type: 'nativeEffect', id: 'shared' });
		f.manager.updateDynamicOptions({ customNodeGraphEffects: ['selected', 'other'].map(id => ({ id, name: id, definition: structuredClone(child) })) });
		f.manager.startEffectLivePreview({ effectSource: { type: 'customNodeGraphEffectReference', id: 'selected' } });
		const edit = id => f.manager.applyProjectChanges([{ type: 'node', customNodeGraphEffectId: id,
			node: { ...child.nodes[0], params: { value: literal(3) } }, changes: [{ type: 'parameter', kind: 'value' }] }]);
		await f.frame(10);
		if (editDuringInitialization) edit('selected');
		initialization.resolve();
		await new Promise(resolve => setImmediate(resolve));
		if (!editDuringInitialization) {
			assert.deepEqual(f.errors, ['Invalid initial value']);
			edit('other');
			await f.frame(20);
			assert.deepEqual(initialized, [0]);
			edit('selected');
		}
		await f.frame(30);
		assert.deepEqual(initialized, [0, 3]);
		assert.deepEqual(rendered, [3]);
		assert.equal(f.errors.length, editDuringInitialization ? 0 : 1);
	}
});
