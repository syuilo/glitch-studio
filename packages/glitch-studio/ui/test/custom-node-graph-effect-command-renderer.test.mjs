import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { wgslShaderEsbuildPlugin } from '@gs/shared/build/wgsl-shader.mjs';

const literal = value => ({ inputSource: 'literal', value });
const connection = nodeId => ({ inputSource: 'node', nodeId, outputPort: 'output' });
const effectDefinitions = {
	probe: {
		id: 'probe',
		paramDefs: { input: {
			dataType: { kind: 'color' }, canNode: true,
			ui: { label: 'Input', control: {} }, defaultValue: literal([0, 0, 0, 0]),
		} },
		primaryInputParameter: 'input', resolutionInputParameters: ['input'],
		primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } },
	},
};

// UIとレンダラーで同じ定義を使い、Commandの通知からGPU資源の再構築までを実コードで通す。
// Vite専用のエフェクト一覧だけを差し替え、テスト用の定義をCommandへ注入する。
const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: directory,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { CustomNodeGraphEffectRendererManager } from '@gs/glitch-studio_renderer/custom-node-graph-effect-renderer-manager.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	loader: { '.wgsl': 'text' },
	plugins: [wgslShaderEsbuildPlugin(), { name: 'command-renderer-effects', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'command-renderer-test' }));
		build.onLoad({ filter: /.*/, namespace: 'command-renderer-test' }, () => ({
			contents: `export const effectDefinitions = ${JSON.stringify(effectDefinitions)};`, loader: 'ts',
		}));
	} }],
});

// 実GPUを必要とする実行だけを置き換える。出力テクスチャの寸法は実レンダラーの計画から決まる。
const globalDescriptors = ['GPUQueue', 'GPUTextureUsage', 'GPUBufferUsage', 'GPUShaderStage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const gpuDescriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
globalThis.GPUQueue = class { submit() {} };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
Object.defineProperty(navigator, 'gpu', { configurable: true, value: { getPreferredCanvasFormat: () => 'rgba8unorm' } });
after(() => {
	for (const [key, descriptor] of globalDescriptors) {
		if (descriptor != null) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	if (gpuDescriptor != null) Object.defineProperty(navigator, 'gpu', gpuDescriptor);
	else delete navigator.gpu;
});
const bundledModule = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), bundledModule, bundledModule.exports);
const { COMMAND_DEFS, UndoRedo, RendererProjectSynchronizer, CustomNodeGraphEffectRendererManager } = bundledModule.exports;

function gpuFixture() {
	const texture = ({ size = [1, 1], format = 'rgba8unorm' } = {}) => ({
		width: size.width ?? size[0], height: size.height ?? size[1], format,
		depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1, dimension: '2d',
		createView: () => ({}), destroy() {},
	});
	const device = {
		limits: { maxTextureDimension2D: 8192 }, features: new Set(), destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() {} }),
		createShaderModule: () => ({}), createSampler: () => ({}), createBindGroup: () => ({}),
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) }),
		queue: { submit() {}, async onSubmittedWorkDone() {}, writeTexture() {}, writeBuffer() {} },
	};
	return { device, texture };
}

async function fixture(t) {
	const node = (id, resolution, input = literal([0, 0, 0, 0])) => ({
		id, type: 'effect', effectId: 'probe', displayName: '', isBypass: false,
		resolution, staticSettings: {}, params: { input }, pos: { x: 0, y: 0 },
	});
	const customNodeGraphEffect = {
		id: 'custom-node-graph-effect', name: 'Resolution test', paramDefs: [], customParameterDefs: [], customParameterValues: {}, automationGraphs: [],
		outputDefs: [{ id: 'output', name: 'output', label: 'Output', dataType: { kind: 'color' } }], primaryInputId: null, primaryOutputId: 'output',
		nodes: [
			node('small-source', { mode: 'customAbsolute', width: 16, height: 16 }),
			node('large-source', { mode: 'customAbsolute', width: 32, height: 24 }),
			node('consumer', { mode: 'auto', scale: 1 }, connection('small-source')),
			{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'consumer', outputPort: 'output' } } },
		],
	};
	const manager = new UndoRedo({ customNodeGraphEffects: { value: [customNodeGraphEffect] }, customShaderEffects: { value: [] } }, COMMAND_DEFS);
	const { device, texture } = gpuFixture();
	const frames = new Map();
	let frameId = 0;
	let timestamp = 0;
	const errors = [];
	const renderedResolutions = [];
	const renderer = await CustomNodeGraphEffectRendererManager.create({
		gpuDevice: device,
		gpuContext: { canvas: { width: 64, height: 48 }, configure() {}, getCurrentTexture: texture },
		frameScheduler: { now: () => 0, requestFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelFrame: id => frames.delete(id) },
		effectDefinitions,
		effectImplementations: { probe: {
			outputTextureFactories: { output: ({ resolution }) => texture({ size: resolution }) },
			init: () => ({ render() {}, dispose() {} }),
		} },
	}, { enableStats: false, enableWaveformAndHistogram: false, enable32bitDataTextures: false }, { assets: [], players: [] });
	renderer.on('ev', event => { if (event.type === 'renderError') errors.push(event.ctx.message); });
	// 表示処理以外は差し替えず、実際にCanvasへ渡される最終出力の寸法を観測する。
	renderer.canvasRenderer.renderToCanvas = output => renderedResolutions.push({ width: output.width, height: output.height });
	renderer.updateDynamicOptions({ resolution: { width: 64, height: 48 }, customNodeGraphEffects: structuredClone([customNodeGraphEffect]) });
	renderer.startCustomNodeGraphEffectLivePreviewRenderLoopFor(customNodeGraphEffect.id);
	const synchronizer = new RendererProjectSynchronizer(manager, {
		apply: async changes => renderer.applyProjectChanges(changes),
		onUpdated() {}, onError: error => errors.push(error),
	});
	t.after(() => { synchronizer.dispose(); renderer.destroy(); });
	return {
		manager,
		target: { target: { customNodeGraphEffect: { customNodeGraphEffectId: customNodeGraphEffect.id }, nodeId: 'consumer' }, parameterPath: ['input'] },
		async assertResolution(expected) {
			await synchronizer.flush();
			const count = renderedResolutions.length;
			const [id, callback] = frames.entries().next().value;
			frames.delete(id);
			callback(timestamp += 16);
			await Promise.resolve();
			assert.deepEqual(errors, []);
			assert.equal(renderedResolutions.length, count + 1);
			assert.deepEqual(renderedResolutions.at(-1), expected);
		},
	};
}

// 【接続先の変更・Undo・Redoで自動解像度を再計算し、連続値編集の履歴でも構造変更を失わない】
// 保存値だけが変わっても、Commandが接続変更を値変更として通知するとレンダラーは古い寸法を保持する。
// ノード入力から定数へ切り替えた直後の連続編集を自動マージした場合も、Undo/Redoで接続を戻すための通知が必要。
test('recalculates automatic resolution through rewiring and merged source edits', async t => {
	const f = await fixture(t);
	await f.assertResolution({ width: 16, height: 16 });
	await f.manager.execute('setCustomNodeGraphEffectNodeParameterSource', { ...f.target, source: connection('large-source') });
	await f.assertResolution({ width: 32, height: 24 });
	f.manager.undo();
	await f.assertResolution({ width: 16, height: 16 });
	f.manager.redo();
	await f.assertResolution({ width: 32, height: 24 });

	await f.manager.execute('setCustomNodeGraphEffectNodeParameterSource', { ...f.target, source: literal([1, 0, 0, 1]) });
	await f.assertResolution({ width: 64, height: 48 });
	await f.manager.execute('setCustomNodeGraphEffectNodeParameterSource', { ...f.target, source: literal([0, 1, 0, 1]) });
	await f.assertResolution({ width: 64, height: 48 });
	assert.equal(f.manager.undoStack.value.length, 2);
	f.manager.undo();
	await f.assertResolution({ width: 32, height: 24 });
	f.manager.redo();
	await f.assertResolution({ width: 64, height: 48 });
});

// 【Binding全体の置換でも、接続先に依存するGPU出力の寸法を更新する】
// 貼り付け等の置換経路が専用の入力方式変更と異なる通知を出すと、同じ接続でも表示が一致しなくなる。
test('recalculates automatic resolution when replacing a node binding', async t => {
	const f = await fixture(t);
	await f.assertResolution({ width: 16, height: 16 });
	await f.manager.execute('replaceCustomNodeGraphEffectNodeParameterBinding', { ...f.target, binding: connection('large-source') });
	await f.assertResolution({ width: 32, height: 24 });
	f.manager.undo();
	await f.assertResolution({ width: 16, height: 16 });
	f.manager.redo();
	await f.assertResolution({ width: 32, height: 24 });
});
