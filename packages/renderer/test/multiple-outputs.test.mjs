import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createDevice } from './helpers/gpu-device.mjs';

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
	const { Renderer } = await server.ssrLoadModule('/src/renderer.ts');
	const { fxDefinitions } = await server.ssrLoadModule('@glitch/shared/effect-definitions.ts');
	const { fxImplementations } = await server.ssrLoadModule('/src/effect-implementations.ts');
	const connection = (nodeId, outputPort = 'color') => ({ nodeId, outputPort });
	const source = (id = 'source') => ({ id, type: 'effect', effectId: 'testSource', isBypass: true, params: {} });
	const sink = (input, scalar = null) => ({
		id: 'sink', type: 'effect', effectId: 'testSink', isBypass: true,
		params: { input: { type: 'literal', value: input }, amount: scalar == null ? { type: 'literal', value: 0 } : { type: 'node', ...scalar } },
	});
	const group = nodes => ({ id: 'group', type: 'group', isBypass: true, nodes, macros: [] });
	fxDefinitions.testSource = { paramDefs: {}, outputs: { color: { dataType: 'color', primary: true }, mask: { dataType: 'scalar', primary: false } } };
	fxDefinitions.testSink = { paramDefs: { input: { type: 'node', primary: true }, amount: { type: 'range', canNode: true } }, outputs: { result: { dataType: 'color', primary: true } } };
	function setup(t, nodes, history = false) {
		const device = createDevice(false);
		const allocated = [];
		const draws = [];
		let canvasInput;
		device.createBindGroup = descriptor => {
			if (descriptor.entries.length === 2 && descriptor.entries[1].binding === 2) canvasInput = descriptor.entries[1].resource.texture;
			return descriptor;
		};
		for (const name of ['testSource', 'testSink']) {
			fxImplementations[name] = {
				needsPreviousFrame: history && name === 'testSource', disableCache: history && name === 'testSource',
				getOut: () => Object.fromEntries(Object.keys(fxDefinitions[name].outputs).map(port => {
					const texture = device.createTexture({ size: [16, 16] });
					t.mock.method(texture, 'destroy');
					allocated.push(texture);
					return [port, texture];
				})),
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
		const renderer = new Renderer({ gpuDevice: device, gpuContext: context, histogramGpuContext: context, waveformHorizontalGpuContext: context, resolution: { width: 16, height: 16 }, enableFloat32Filtering: false, enableStats: false, fpsLimit: null, assets: [], macros: [], automations: [], nodes });
		t.after(() => renderer.destroy());
		t.mock.method(renderer, 'startRenderLoop', () => {});
		return { renderer, allocated, get canvasInput() { return canvasInput; }, frame(id = 'sink') {
			draws.length = 0;
			renderer.render(id, { time: performance.now() });
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
		run.renderer.updateNodes(nodes('mask'));
		const changed = run.frame();
		assert.equal(changed.length, 1);
		assert.equal(changed[0].params.input, first[0].outputs.mask.texture);
	});
	await t.test('bypass and nested groups preserve the selected source port', t => {
		const bypass = { ...sink(connection('source', 'mask')), isBypass: false };
		const run = setup(t, [source(), group([{ ...group([bypass]), id: 'inner' }])]);
		const draws = run.frame('group');
		assert.equal(draws.length, 1);
		assert.equal(run.canvasInput, draws[0].outputs.mask.texture);
	});
	await t.test('unconnected inputs and empty groups use fallback', t => {
		const run = setup(t, [source(), sink(null)]);
		assert.equal(run.frame()[0].params.input.width, 1);
		run.renderer.updateNodes([group([])]);
		assert.deepEqual(run.frame('group'), []);
		assert.equal(run.canvasInput.width, 1);
	});
	await t.test('broken node and port references are not silently treated as unconnected', t => {
		for (const input of [connection('missing', 'color'), connection('source', 'missing')]) {
			const run = setup(t, [source(), sink(input)]);
			assert.throws(() => run.frame(), TypeError);
		}
	});
	await t.test('unconnected inputs never request a texture without a port', t => {
		for (const input of [{ type: 'literal', value: null }, { type: 'node', nodeId: null, outputPort: null }]) {
			const target = sink(null);
			target.params.input = input;
			target.params.amount = { type: 'node', nodeId: null, outputPort: null };
			const run = setup(t, [target]);
			const getOutputTexture = run.renderer.getOutputTexture;
			t.mock.method(run.renderer, 'getOutputTexture', function (node, port) {
				assert.equal(typeof port, 'string', 'texture lookup requires an explicit output port');
				return getOutputTexture.call(this, node, port);
			});
			const draw = run.frame()[0];
			assert.equal(draw.params.input.width, 1);
			assert.equal(draw.params.amount.format, 'r16float');
		}
	});
	await t.test('changing a bypass input port invalidates downstream cache', t => {
		const nodes = port => [source(), { ...sink(connection('source', port)), id: 'bypass', isBypass: false }, sink(connection('bypass', 'result'))];
		const run = setup(t, nodes('color'));
		const first = run.frame();
		assert.equal(first.length, 2);
		assert.equal(run.frame().length, 0);
		run.renderer.updateNodes(nodes('mask'));
		const second = run.frame();
		assert.equal(second.length, 1);
		assert.equal(second[0].params.input, first[0].outputs.mask.texture);
	});
	await t.test('node-valued inputs retain their port and explicit primary ports are selectable', t => {
		const target = sink(null);
		target.params.input = { type: 'node', ...connection('source', 'mask') };
		const run = setup(t, [source(), target]);
		const first = run.frame();
		assert.equal(first[1].params.input, first[0].outputs.mask.texture);
		run.renderer.updateNodes([source(), sink(connection('source', 'color'))]);
		assert.equal(run.frame()[0].params.input, first[0].outputs.color.texture);
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
		for (const texture of run.allocated) assert.equal(texture.destroy.mock.callCount(), 1);
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
		for (const texture of old) assert.equal(texture.destroy.mock.callCount(), 1);
		assert.equal(run.frame().length, 2);
		run.renderer.updateNodes([]);
		for (const texture of run.allocated) assert.equal(texture.destroy.mock.callCount(), 1);
	});
	await t.test('cycles through named ports are rejected', t => {
		const run = setup(t, [sink(connection('sink', 'result'))]);
		assert.throws(() => run.frame(), /circular dependency/);
	});
	await t.test('bypass cycles through named ports are rejected', t => {
		const run = setup(t, [{ ...sink(connection('sink', 'result')), isBypass: false }]);
		assert.throws(() => run.frame(), /circular dependency/);
	});
});
