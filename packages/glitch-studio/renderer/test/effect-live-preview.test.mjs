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
	let clock = 0;
	let frame;
	const manager = await EffectLivePreviewManager.create({
		gpuDevice: device, canvasOutput: { format: 'rgba8unorm', colorSpace: 'srgb' }, gpuContext: { canvas: { width: 2, height: 1 }, configure() {}, getCurrentTexture: texture },
		frameScheduler: { now: () => clock, requestFrame(callback) { frame = callback; return 1; }, cancelFrame() {} },
		nativeEffectDefinitions: { shared: definition }, nativeEffectImplementations: { shared: implementation },
	}, { enable32bitDataTextures: false, effectRenderTiling: { mode: 'disabled' }, enableStats: false, enableWaveformAndHistogram: false }, { assets: [] });
	t.after(() => manager.destroy());
	manager.on('ev', event => { if (event.type === 'renderError') errors.push(event.ctx.message); });
	manager.updateDynamicOptions({ resolution: { width: 5, height: 3 },
		customShaderEffects: [{ id: 'shared', name: 'Shader', summary: '', definition: shader }],
		nodesEffects: [{ id: 'shared', name: 'Graph', definition: graph(reference) }] });
	manager.canvasRenderer.renderToCanvas = (texture, _encoder, time) => submitted.push({ texture, time });
	return { manager, device, submitted, errors, setClock(time) { clock = time; }, async frame(time) { frame(time); await new Promise(resolve => setImmediate(resolve)); } };
}

// 【クリック履歴を内容時刻とノードの座標で渡す】
// FPSの制限中に受け取ったクリックも時刻を丸めず、次の入力やプレビュー対象の切替が済んだフレームを変えない。
test('snapshots recent clicks in node coordinates and clears them for a new preview', async t => {
	const frames = [];
	const f = await fixture(t, { init() { return { render(frame) { frames.push(frame); }, dispose() {} }; } });
	const nodesEffect = graph({ type: 'nativeEffect', id: 'shared' });
	nodesEffect.nodes[0].resolution = { mode: 'customAbsolute', width: 3, height: 6 };
	const placement = { effectSource: { type: 'inlineNodesEffect', nodesEffect }, outputPort: 'scalar' };
	f.manager.updateDynamicOptions({ fpsLimit: 10 });
	f.manager.startEffectLivePreview(placement);
	await f.frame(20);

	f.setClock(100);
	for (let index = 0; index < 17; index++) f.manager.click({ x: index / 16, y: -0.5 });
	await f.frame(120);
	const snapshot = frames.at(-1);
	assert.equal(snapshot.time, 0.12);
	assert.equal(snapshot.pointerClicks.length, 16);
	assert.deepEqual(snapshot.pointerClicks[0], { position: [0.25, -0.25], time: 0.1 });
	assert.deepEqual(snapshot.pointerClicks.at(-1), { position: [0.015625, -0.25], time: 0.1 });

	f.setClock(180);
	f.manager.click({ x: -1, y: 1 });
	await f.frame(220);
	assert.deepEqual(frames.at(-1).pointerClicks[0], { position: [-0.25, 0.5], time: 0.18 });
	assert.deepEqual(snapshot.pointerClicks[0], { position: [0.25, -0.25], time: 0.1 });

	f.setClock(220);
	f.manager.startEffectLivePreview(placement);
	await f.frame(240);
	assert.deepEqual(frames.at(-1).pointerClicks, []);
	assert.deepEqual(f.errors, []);
});

// 【まとめられたポインター位置の時刻を内容時刻に換算し、途切れた入力をつながない】
// UIとWorkerのtimeOriginや受信時刻が異なっても、描画間の折り返しと実際の入力間隔を保つ。
// 停止中に取得した位置が再開後の軌跡に混ざる回帰も防ぐ。
test('preserves the sampled positions and times in a pointer stroke batch', async t => {
	const frames = [];
	const f = await fixture(t, { init() { return { render(frame) { frames.push(frame); }, dispose() {} }; } });
	f.manager.updateDynamicOptions({ resolution: { width: 8, height: 4 }, effectLivePreviewTimeFactor: 2 });
	f.setClock(100);
	f.manager.startEffectLivePreview({ effectSource: { type: 'nativeEffect', id: 'shared' } });
	await f.frame(120);

	const timeOrigin = performance.timeOrigin - 1000;
	const sample = (timeStamp, x, y) => ({ position: { x, y }, timeStamp });
	const update = samples => f.manager.updatePointerPosition({ x: 0.5, y: -0.5 }, { pointerId: 1, timeOrigin, samples });
	f.setClock(147);
	update([sample(1120, 0.5, 0.5)]);
	update([
		sample(1095, -1, -1),
		sample(1110, -0.5, 0), sample(1115, 0, 0.5), sample(1125, -0.5, 0),
		{ position: null, timeStamp: 1130 },
		sample(1135, 0.5, 0), sample(1140, 0.5, -0.5),
	]);
	await f.frame(150);
	assert.deepEqual(frames.at(-1).pointerPosition, [0.25, -0.125]);
	assert.deepEqual(frames.at(-1).pointerStrokeSegments, [
		{ start: [-0.25, 0], end: [0, 0.125], startTime: 0.02, endTime: 0.03 },
		{ start: [0, 0.125], end: [-0.25, 0], startTime: 0.03, endTime: 0.05 },
		{ start: [0.25, 0], end: [0.25, -0.125], startTime: 0.07, endTime: 0.08 },
	]);

	f.setClock(155);
	f.manager.updateDynamicOptions({ effectLivePreviewTimeFactor: 0 });
	update([sample(1157, -1, -1), sample(1159, -1, 1)]);
	await f.frame(160);
	assert.deepEqual(frames.at(-1).pointerStrokeSegments, []);

	f.setClock(170);
	f.manager.updateDynamicOptions({ effectLivePreviewTimeFactor: 2 });
	update([sample(1165, -1, 0), sample(1171, 0, 0), sample(1175, 0.5, 0)]);
	await f.frame(180);
	assert.deepEqual(frames.at(-1).pointerStrokeSegments, [
		{ start: [0, 0], end: [0.25, 0], startTime: 0.122, endTime: 0.13 },
	]);
	assert.deepEqual(f.errors, []);
});

// 【全5種類のEffectSourceを同じWorker用Managerから描画する】
// 名前空間に同じIDを持つ登録があっても指定した種類・ポートだけを計画し、データ出力を元のチャンネル形式で表示する。
test('previews every source kind with a fixed output port and native channel format', async t => {
	const ports = [];
	const f = await fixture(t, { init({ outputTextures }) { ports.push([...outputTextures.keys()]); return { render() {}, dispose() {} }; } });
	for (const effectSource of [{ type: 'nativeEffect', id: 'shared' }, reference, { type: 'inlineCustomShaderEffect', customShaderEffect: shader },
		{ type: 'nodesEffectReference', id: 'shared' }, { type: 'inlineNodesEffect', nodesEffect: graph(reference) }]) {
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

// 【カスタム寸法はプレビュー倍率に関わらず適用し、解除時に最新のプロジェクト設定を使う】
// 対象の切替で直前のカスタム寸法を引き継ぐと、別のEffectの構図や描画負荷も変わってしまう。
test('renders placement-specific preview dimensions and falls back to current project dimensions', async t => {
	const f = await fixture(t);
	const outputSizes = [];
	f.manager.on('ev', event => { if (event.type === 'outputResolution') outputSizes.push(event.ctx); });
	const assertSize = (width, height) => {
		const { texture } = f.submitted.at(-1);
		assert.deepEqual([texture.width, texture.height], [width, height]);
		assert.deepEqual(outputSizes.at(-1), { width, height });
	};
	f.manager.updateDynamicOptions({ resolutionScale: 0.5 });
	f.manager.startEffectLivePreview({ effectSource: reference, customResolution: { width: 4, height: 9 } });
	await f.frame(25);
	assertSize(4, 9);

	f.manager.updateDynamicOptions({ resolution: { width: 24, height: 16 }, resolutionScale: 0.25 });
	await f.frame(50);
	assertSize(4, 9);
	f.manager.updateEffectLivePreviewResolution({ width: 10, height: 7 });
	await f.frame(75);
	assertSize(10, 7);
	f.manager.updateEffectLivePreviewResolution(null);
	await f.frame(100);
	assertSize(6, 4);

	f.manager.updateEffectLivePreviewResolution({ width: 4, height: 9 });
	f.manager.startEffectLivePreview({ effectSource: { type: 'nodesEffectReference', id: 'shared' } });
	await f.frame(125);
	assertSize(6, 4);
	assert.deepEqual(f.errors, []);
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
	f.manager.startEffectLivePreview({ effectSource: { type: 'inlineNodesEffect', nodesEffect: graph({ type: 'nodesEffectReference', id: 'shared' }) } }, 'id');
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
	const nodesEffectSource = { type: 'nodesEffectReference', id: 'shared' };
	const registered = { id: 'shared', name: 'Graph', definition: graph({ type: 'nativeEffect', id: 'shared' }) };
	f.manager.updateDynamicOptions({ nodesEffects: [registered] });
	f.manager.startEffectLivePreview({ effectSource: nodesEffectSource });
	await f.frame(10);
	f.manager.updateDynamicOptions({ nodesEffects: [structuredClone(registered), { ...registered, id: 'other' }] });
	await f.frame(20);
	assert.equal(disposed, 0);
	const changed = structuredClone(registered);
	changed.definition.nodes[0].params.value = literal(1);
	f.manager.updateDynamicOptions({ nodesEffects: [changed] });
	await f.frame(30);
	assert.equal(disposed, 1);
	f.manager.updateDynamicOptions({ nodesEffects: [registered] });
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
	f.manager.updateDynamicOptions({ nodesEffects: [{ id: 'inner', name: 'Inner', definition: child }] });
	f.manager.startEffectLivePreview({ effectSource: { type: 'inlineNodesEffect', nodesEffect: graph({ type: 'nodesEffectReference', id: 'inner' }) } });
	const edit = value => f.manager.applyProjectChanges([{ type: 'node', nodesEffectId: 'inner',
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
test('recovers the selected Nodes Effect when its node value is corrected during or after failed initialization', async t => {
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
		f.manager.updateDynamicOptions({ nodesEffects: ['selected', 'other'].map(id => ({ id, name: id, definition: structuredClone(child) })) });
		f.manager.startEffectLivePreview({ effectSource: { type: 'nodesEffectReference', id: 'selected' } });
		const edit = id => f.manager.applyProjectChanges([{ type: 'node', nodesEffectId: id,
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
