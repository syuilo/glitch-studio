import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createDevice } from './helpers/gpu-device.mjs';
import { createLiveGraph } from './helpers/live-graph.mjs';

test('multiple output rendering', async t => {
	const server = await createServer({
		root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
		server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom',
		optimizeDeps: { noDiscovery: true, include: [] },
	});
	t.after(() => server.close());
	const previousGpu = navigator.gpu;
	navigator.gpu = { getPreferredCanvasFormat: () => 'bgra8unorm' };
	t.after(() => { navigator.gpu = previousGpu; });
	const { MainRenderer } = await server.ssrLoadModule('/src/renderer.ts');
	const { effectDefinitions: fxDefinitions } = await server.ssrLoadModule('@glitch/shared/effect-definitions.ts');
	const { effectImplementations: fxImplementations } = await server.ssrLoadModule('@glitch/shared/effect-implementations.js');
	const connection = (nodeId, outputPort = 'color') => ({ nodeId, outputPort });
	const source = (id = 'source') => ({ id, type: 'effect', effectId: 'testSource', isBypass: false, params: {} });
	const sink = (input, scalar = null) => ({
		id: 'sink', type: 'effect', effectId: 'testSink', isBypass: false,
		params: { input: { type: 'node', ...(input ?? { nodeId: null, outputPort: null }) }, amount: scalar == null ? { type: 'literal', value: 0 } : { type: 'node', ...scalar } },
	});
	
	fxDefinitions.testSource = { paramDefs: {}, outputs: { color: { dataType: 'color', primary: true }, mask: { dataType: 'scalar', primary: false } } };
	fxDefinitions.testSink = { paramDefs: { input: { type: 'color', canNode: true, primary: true }, amount: { type: 'range', canNode: true } }, outputs: { result: { dataType: 'color', primary: true } } };
	function setup(t, nodes, history = false) {
		const device = createDevice(false);
		const allocated = [];
		const destroyed = new Map();
		const draws = [];
		let canvasInput;
		device.createBindGroup = descriptor => {
			const input = descriptor.entries.find(entry => entry.binding === 2 && entry.resource.texture);
			if (input) canvasInput = input.resource.texture;
			return descriptor;
		};
		for (const name of ['testSource', 'testSink']) {
			fxImplementations[name] = {
				needsPreviousFrame: history && name === 'testSource', disableCache: history && name === 'testSource',
				outputTextureFactories: Object.fromEntries(Object.keys(fxDefinitions[name].outputs).map(port => [port, () => {
					const texture = device.createTexture({ size: [16, 16] });
					texture.destroy = () => destroyed.set(texture, (destroyed.get(texture) ?? 0) + 1);
					allocated.push(texture);
					return texture;
				}])),
				init: () => ({ dispose() {}, render(ctx) {
					const outputs = Object.fromEntries(Object.entries(ctx.outputDataMap).map(([port, data]) => [port, { ...data }]));
					for (const data of Object.values(outputs)) {
						assert.equal(data.textureView?.texture, data.texture, 'view must belong to the write texture');
						if (data.previousFrameTexture) {
							assert.equal(data.previousFrameTextureView.texture, data.previousFrameTexture);
							assert.notEqual(data.texture, data.previousFrameTexture, 'history must not alias the write texture');
						}
						ctx.createPassEncoderFor(ctx.commandEncoder, data.textureView).end();
					}
					draws.push({ name, outputs, params: ctx.params });
				} }),
			};
		}
		const context = { configure() {}, unconfigure() {}, getCurrentTexture: () => device.createTexture() };
		const renderer = new MainRenderer({ gpuDevice: device, gpuContext: context, histogramGpuContext: context, waveformHorizontalGpuContext: context, waveformVerticalGpuContext: context, intermediateTextureFormat: 'rgba16float', resolution: { width: 16, height: 16 }, enable32bitDataTextures: false, enableStats: false, fpsLimit: null, assets: [], automations: [] });
		t.after(() => renderer.destroy());
		const graph = createLiveGraph(renderer, nodes, fxDefinitions);
		return { renderer, updateNodes: graph.updateNodes, allocated, destroyed, get canvasInput() { return canvasInput; }, frame(id = 'sink') {
			draws.length = 0;
			graph.frame(id, performance.now());
			return [...draws];
		} };
	}
	await t.test('renders dependencies, selects ports and invalidates cache on port changes', t => {
		const nodes = port => [source(), sink(connection('source', port), connection('source', 'mask'))];
		const run = setup(t, nodes('color'));
		const first = run.frame();
		assert.equal(first.length, 2);
		assert.equal(first[1].params.input, first[0].outputs.color.texture);
		assert.equal(first[1].params.amount, first[0].outputs.mask.texture);
		assert.equal(run.canvasInput, first[1].outputs.result.texture);
		assert.equal(run.frame().length, 0);
		run.updateNodes(nodes('mask'));
		const changed = run.frame();
		assert.equal(changed.length, 2);
		assert.equal(changed[1].params.input, first[0].outputs.mask.texture);
	});
	await t.test('bypass preserves the selected source port', t => {
		const bypass = { ...sink(connection('source', 'mask')), isBypass: true };
		const run = setup(t, [source(), bypass]);
		const draws = run.frame('sink');
		assert.equal(draws.length, 1);
		assert.equal(run.canvasInput, draws[0].outputs.mask.texture);
	});
	await t.test('unconnected inputs and empty modules use fallback', t => {
		const run = setup(t, [source(), sink(null)]);
		assert.equal(run.frame()[0].params.input.width, 1);
		run.updateNodes([]);
		assert.deepEqual(run.frame('group'), []);
		assert.equal(run.canvasInput.width, 16, 'an absent output does not submit a new canvas pass');
	});
	await t.test('missing nodes are rejected and missing ports use the scalar fallback', t => {
		for (const input of [connection('missing', 'color'), connection('source', 'missing')]) {
			const run = setup(t, [source(), sink(input)]);
			if (input.nodeId === 'missing') assert.throws(() => run.frame(), /Referenced node not found/);
			else assert.equal(run.frame().at(-1).params.input.format, 'r16float');
		}
	});
	await t.test('unconnected inputs never request a texture without a port', t => {
		for (const input of [{ type: 'node', nodeId: null, outputPort: null }]) {
			const target = sink(null);
			target.params.input = input;
			target.params.amount = { type: 'node', nodeId: null, outputPort: null };
			const run = setup(t, [target]);
			const draw = run.frame()[0];
			assert.equal(draw.params.input.width, 1);
			assert.equal(draw.params.amount.format, 'r16float');
		}
	});
	await t.test('changing a bypass input port invalidates downstream cache', t => {
		const nodes = port => [source(), { ...sink(connection('source', port)), id: 'bypass', isBypass: true }, sink(connection('bypass', 'result'))];
		const run = setup(t, nodes('color'));
		const first = run.frame();
		assert.equal(first.length, 2);
		assert.equal(run.frame().length, 0);
		run.updateNodes(nodes('mask'));
		const second = run.frame();
		assert.equal(second.length, 2);
		assert.equal(second[1].params.input, first[0].outputs.mask.texture);
	});
	await t.test('node-valued inputs retain their port and explicit primary ports are selectable', t => {
		const target = sink(null);
		target.params.input = { type: 'node', ...connection('source', 'mask') };
		const run = setup(t, [source(), target]);
		const first = run.frame();
		assert.equal(first[1].params.input, first[0].outputs.mask.texture);
		run.updateNodes([source(), sink(connection('source', 'color'))]);
		assert.equal(run.frame()[1].params.input, first[0].outputs.color.texture);
	});
	await t.test('scalar-only dependencies render before their consumer', t => {
		const run = setup(t, [source(), sink(null, connection('source', 'mask'))], true);
		for (let frame = 0; frame < 2; frame++) {
			const draws = run.frame();
			assert.equal(draws.length, 2);
			assert.equal(draws[1].params.amount, draws[0].outputs.mask.texture);
		}
	});
	await t.test('destroy releases every output and history texture', t => {
		const run = setup(t, [source()], true);
		run.frame('source');
		run.renderer.destroy();
		assert.equal(run.allocated.length, 4);
		for (const texture of run.allocated) assert.equal(run.destroyed.get(texture), 1);
	});
	await t.test('all output histories alternate and are released on resize and removal', t => {
		const run = setup(t, [source(), sink(connection('source', 'mask'), connection('source', 'color'))], true);
		const first = run.frame();
		const second = run.frame();
		assert.equal(first.length, 2);
		assert.equal(second.length, 2);
		for (const port of ['color', 'mask']) {
			assert.equal(second[0].outputs[port].previousFrameTexture, first[0].outputs[port].texture);
			assert.equal(second[0].outputs[port].texture, first[0].outputs[port].previousFrameTexture);
		}
		assert.equal(second[1].params.input, second[0].outputs.mask.texture);
		const old = [...run.allocated];
		run.renderer.resize({ width: 32, height: 32 });
		for (const texture of old) assert.equal(run.destroyed.get(texture), 1);
		assert.equal(run.frame().length, 2);
		run.updateNodes([]);
		for (const texture of run.allocated) assert.equal(run.destroyed.get(texture), 1);
	});
	await t.test('cycles through named ports are rejected', t => {
		const run = setup(t, [sink(connection('sink', 'result'))]);
		assert.throws(() => run.frame(), /circular dependency/);
	});
	await t.test('bypass cycles through named ports are rejected', t => {
		const run = setup(t, [{ ...sink(connection('sink', 'result')), isBypass: true }]);
		assert.throws(() => run.frame(), /circular dependency/);
	});
});
