import { testGraph } from './helpers/effect-graph.mjs';
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
		kind: 'modify',
		paramDefs: { input: {
			dataType: { kind: 'color' }, canNode: true,
			ui: { label: 'Input', control: {} }, defaultValue: literal([0, 0, 0, 0]),
		} },
		primaryInputParameter: 'input', resolutionInputParameters: ['input'],
		primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } },
	},
};

// UIとレンダラーで同じ定義を使い、Commandの通知からGPU資源の再構築までを実コードで通す。
// テスト用のEffect定義を登録し、エディタ設定はブラウザのストレージを介さずに渡す。
const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: directory,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { commitCustomNodeGraphEffectEdit } from './src/utility/custom-node-graph-effect-edit.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { EffectLivePreviewManager } from '@gs/glitch-studio_renderer/effect-live-preview-manager.ts';
		export { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	loader: { '.wgsl': 'text' },
	plugins: [wgslShaderEsbuildPlugin(), { name: 'command-renderer-effects', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'editor-settings' }));
		build.onLoad({ filter: /.*/, namespace: 'editor-settings' }, () => ({ contents: 'export const preferences = { s: { forceTypeSafety: false } };' }));
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'command-renderer-test' }));
		build.onLoad({ filter: /.*/, namespace: 'command-renderer-test' }, () => ({
			contents: `export const nativeEffectDefinitions = ${JSON.stringify(effectDefinitions)};`, loader: 'ts',
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
const { COMMAND_DEFS, UndoRedo, commitCustomNodeGraphEffectEdit, RendererProjectSynchronizer, EffectLivePreviewManager, createEffectInstance } = bundledModule.exports;

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
		id, type: 'effect', effectSource: { type: 'nativeEffect', id: 'probe' }, displayName: '', isBypass: false,
		resolution, staticSettings: {}, params: { input }, pos: { x: 0, y: 0 },
	});
	const customNodeGraphEffect = {
		id: 'custom-node-graph-effect', name: 'Resolution test', definition: testGraph({ outputSources: { output: { nodeId: 'consumer', outputPort: 'output' } },
		nodes: [
			node('small-source', { mode: 'customAbsolute', width: 16, height: 16 }),
			node('large-source', { mode: 'customAbsolute', width: 32, height: 24 }),
			node('consumer', { mode: 'auto', scale: 1 }, { inputSource: 'node', source: { nodeId: 'small-source', outputPort: 'output' }, sampling: { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' } }),
		] }),
	};
	const manager = new UndoRedo({ customNodeGraphEffects: { value: [customNodeGraphEffect] }, customShaderEffects: { value: [] } }, COMMAND_DEFS);
	const { device, texture } = gpuFixture();
	const frames = new Map();
	let frameId = 0;
	let timestamp = 0;
	const errors = [];
	const renderedResolutions = [];
	const renderer = await EffectLivePreviewManager.create({
		gpuDevice: device,
		gpuContext: { canvas: { width: 64, height: 48 }, configure() {}, getCurrentTexture: texture },
		frameScheduler: { now: () => 0, requestFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelFrame: id => frames.delete(id) },
		nativeEffectDefinitions: effectDefinitions,
		nativeEffectImplementations: { probe: {
			createOutputTexture: (_id, resolution) => texture({ size: resolution }),
			init: () => ({ render() {}, dispose() {} }),
		} },
	}, { enableStats: false, enableWaveformAndHistogram: false, enable32bitDataTextures: false }, { assets: [], players: [] });
	renderer.on('ev', event => { if (event.type === 'renderError') errors.push(event.ctx.message); });
	// 表示処理以外は差し替えず、実際にCanvasへ渡される最終出力の寸法を観測する。
	renderer.canvasRenderer.renderToCanvas = output => renderedResolutions.push({ width: output.width, height: output.height });
	renderer.updateDynamicOptions({ resolution: { width: 64, height: 48 }, customNodeGraphEffects: structuredClone([customNodeGraphEffect]) });
	renderer.startEffectLivePreview({ effectSource: { type: 'customNodeGraphEffectReference', id: customNodeGraphEffect.id } });
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
			await new Promise(resolve => setImmediate(resolve));
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

const contextResolution = { width: 64, height: 48 };
const imageResolution = { width: 32, height: 24 };
const maskResolution = { width: 16, height: 12 };

function primaryInputFixture(candidates) {
	const color = effectDefinitions.probe.paramDefs.input;
	const definition = testGraph({
		paramDefs: { image: color, mask: color }, primaryInputParameter: 'image', resolutionInputParameters: [...candidates],
		nodes: [{ id: 'consumer', type: 'effect', effectSource: { type: 'nativeEffect', id: 'probe' }, params: {}, resolution: { mode: 'context', scale: 1 } }],
		outputSources: { output: { nodeId: 'consumer', outputPort: 'output' } },
	});
	const target = { customNodeGraphEffectId: 'graph' };
	const manager = new UndoRedo({ customNodeGraphEffects: { value: [{ id: 'graph', definition }] }, timelineScenes: { value: [] } }, COMMAND_DEFS);
	const { device, texture } = gpuFixture();
	const textureInput = resolution => ({ kind: 'texture', resolution, texture: texture({ size: resolution }) });
	return {
		definition, manager, edit: event => commitCustomNodeGraphEffectEdit(manager, target, event),
		async assertResolution(expected) {
			const instance = await createEffectInstance({
				effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: definition },
				definitions: { getNativeEffect: id => effectDefinitions[id] },
				inputs: { image: definition.paramDefs.image.canNode ? textureInput(imageResolution) : { kind: 'value', value: 0 }, mask: textureInput(maskResolution) },
				resolution: contextResolution, resolutionSetting: { mode: 'auto', scale: 1 }, usedOutputPorts: new Set(['output']),
			}, { device }, () => ({ init: () => ({ render() {}, dispose() {} }) }));
			try {
				const { width, height } = instance.outputs.get('output').texture;
				assert.deepEqual({ width, height }, expected);
			} finally { instance.dispose(); }
		},
	};
}

for (const [candidates, expectedResolution] of [
	[['image'], imageResolution],
	[['mask', 'image'], imageResolution],
	[['mask'], maskResolution],
	[[], contextResolution],
]) {
	// 【主入力の解除・再選択・切り替え・Undo/Redoで、明示したAuto解像度の候補と寸法を保つ】
	// エディタのスイッチが送る操作を使い、通常の一候補に加え、複数候補・主入力以外だけ・候補なしも検証する。
	// 主入力を変更しても候補の順序や有無が変わると、同じテクスチャを接続したグラフの描画寸法が変わってしまう。
	test(`preserves Auto resolution for candidates ${JSON.stringify(candidates)} across primary input edits`, async () => {
		const { definition, manager, edit, assertResolution } = primaryInputFixture(candidates);
		function assertState(primary) {
			assert.equal(definition.primaryInputParameter, primary);
			assert.deepEqual(definition.resolutionInputParameters, candidates);
			return assertResolution(expectedResolution);
		}
		for (const inputId of [null, 'image', 'mask']) {
			edit({ kind: 'setPrimaryInput', inputId });
			await assertState(inputId);
		}
		manager.undo();
		await assertState('image');
		manager.undo();
		await assertState(null);
		manager.redo();
		await assertState('image');
		manager.redo();
		await assertState('mask');
	});
}

// 【主入力の色をscalarに変更しても、テクスチャ入力が可能な間は解像度候補に残す】
// 主入力には色が必要だが、Auto解像度にはスカラー場の寸法も使える。テクスチャ接続を無効にした段階だけで候補を外す。
test('removes only ineligible resolution candidates when changing a public parameter', async () => {
	const { definition, manager, edit, assertResolution } = primaryInputFixture(['mask', 'image']);
	edit({ kind: 'updateParamDef', defId: 'image', changes: {
		dataType: { kind: 'scalar' }, defaultValue: literal(0), ui: { label: 'Image', control: { controlType: 'number' } },
	} });
	assert.equal(definition.primaryInputParameter, null);
	assert.deepEqual(definition.resolutionInputParameters, ['mask', 'image']);
	await assertResolution(imageResolution);
	edit({ kind: 'updateParamDef', defId: 'image', changes: { canNode: false } });
	assert.deepEqual(definition.resolutionInputParameters, ['mask']);
	await assertResolution(maskResolution);
	manager.undo();
	assert.deepEqual(definition.resolutionInputParameters, ['mask', 'image']);
	manager.undo();
	assert.equal(definition.primaryInputParameter, 'image');
	manager.redo();
	manager.redo();
	assert.deepEqual(definition.resolutionInputParameters, ['mask']);
});
