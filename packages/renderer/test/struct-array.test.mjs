import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createDevice } from './helpers/gpu-device.mjs';

const literal = value => ({ type: 'literal', value });
const number = { type: 'number', label: 'Number', default: () => literal(0) };
const connection = (nodeId, outputPort = 'output') => ({ type: 'node', nodeId, outputPort });

test('struct and array renderer parameters', async t => {
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
	const { effectDefinitions: definitions } = await server.ssrLoadModule('@glitch/shared/effect-definitions.ts');
	const { effectImplementations: implementations } = await server.ssrLoadModule('@glitch/shared/effect-implementations.js');
	const node = (id, effectId, params = {}) => ({ id, type: 'effect', effectId, params, isBypass: false });
	function setup(t, defs, nodes, enable32bitDataTextures = false) {
		const device = createDevice(false);
		const writes = new Map();
		device.queue.writeTexture = ({ texture }, data) => writes.set(texture, data.slice());
		const allocated = [];
		const destroyed = new Map();
		const createTexture = device.createTexture;
		device.createTexture = descriptor => {
			const texture = createTexture(descriptor);
			texture.destroy = () => destroyed.set(texture, (destroyed.get(texture) ?? 0) + 1);
			allocated.push(texture);
			return texture;
		};
		const draws = [];
		for (const [id, paramDefs] of Object.entries(defs)) {
			definitions[id] = { id, paramDefs, outputs: { output: { dataType: 'color', primary: true }, mask: { dataType: 'scalar', primary: false } } };
			implementations[id] = {
				getOut: () => ({ output: device.createTexture(), mask: device.createTexture() }),
				init: () => ({ dispose() {}, render(ctx) { draws.push({ id, params: ctx.params, outputs: { ...ctx.outputDataMap } }); } }),
			};
			t.after(() => { delete definitions[id]; delete implementations[id]; });
		}
		const context = { configure() {}, unconfigure() {}, getCurrentTexture: () => device.createTexture() };
		const renderer = new Renderer({ gpuDevice: device, gpuContext: context, histogramGpuContext: context,
			waveformHorizontalGpuContext: context, waveformVerticalGpuContext: context,
			resolution: { width: 16, height: 16 }, intermediateTextureFormat: 'rgba16float', enable32bitDataTextures,
			enableStats: false, fpsLimit: null, assets: [], macros: [], automations: [], nodes });
		t.after(() => renderer.destroy());
		let time = performance.now();
		return { renderer, writes, allocated, destroyed, frame(id = 'root') {
			draws.length = 0;
			renderer.render(id, { time: time += 16 });
			return [...draws];
		} };
	}

	await t.test('evaluates nested literals, expressions and automation without mutating serialized state', t => {
		const fields = { x: number, animated: number, matrix: { type: 'array', item: { type: 'array', item: number } } };
		const params = { rows: literal([literal({ x: { type: 'expression', expression: 'WIDTH / 2' }, animated: { type: 'automation', automationId: 'a' }, matrix: literal([literal([literal(3)])]) })]) };
		const nodes = [node('root', 'nested', params)];
		const before = structuredClone(nodes);
		const run = setup(t, { nested: { rows: { type: 'array', item: { type: 'struct', fields } } } }, nodes);
		run.renderer.updateAutomations([{ id: 'a', keyframes: [0, 1000].map(timeMs => ({ id: String(timeMs), timeMs, value: 7, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] })) }]);
		assert.deepEqual(run.frame()[0].params, { rows: [{ x: 8, animated: 7, matrix: [[3]] }] });
		assert.deepEqual(nodes, before);
		assert.equal(run.frame().length, 0);
	});

	for (const precision of [false, true]) await t.test('nested canNode textures and array lifetime, float' + (precision ? 32 : 16), t => {
		const row = { type: 'struct', fields: { amount: { ...number, canNode: true }, vector: { type: 'vector', canNode: true }, color: { type: 'color', canNode: true } } };
		const nodes = rows => [node('root', 'constants', { rows: literal(rows.map(values => literal({ amount: literal(values), vector: literal([0.5, -1]), color: literal([1, 0, 0, 1]) }))) })];
		const run = setup(t, { constants: { rows: { type: 'array', item: row } } }, nodes([0.5, 1]), precision);
		const first = run.frame()[0].params.rows;
		assert.equal(first[0].amount.format, precision ? 'r32float' : 'r16float');
		assert.equal(first[0].vector.format, precision ? 'rg32float' : 'rg16float');
		assert.equal(first[0].color.format, precision ? 'rgba32float' : 'rgba16float');
		assert.deepEqual([...run.writes.get(first[0].amount)], [precision ? 0.5 : 0x3800]);
		assert.deepEqual([...run.writes.get(first[0].vector)], precision ? [0.5, -1] : [0x3800, 0xbc00]);
		run.renderer.updateNodes(nodes([1]));
		assert.equal(run.destroyed.get(first[1].amount), 1);
		const changed = run.frame()[0].params.rows;
		assert.equal(changed[0].amount, first[0].amount);
		run.renderer.updateNodes(nodes([]));
		assert.deepEqual(run.frame()[0].params.rows, []);
		assert.equal(run.destroyed.get(first[0].amount), 1);
		run.renderer.updateNodes(nodes([0.5]));
		assert.notEqual(run.frame()[0].params.rows[0].amount, first[0].amount);
	});

	await t.test('nested connections render dependencies and propagate cache changes and cycles', t => {
		const defs = { source: { value: number }, sink: { rows: { type: 'array', item: { type: 'struct', fields: { input: { type: 'color', canNode: true } } } } } };
		const nodes = (value = 1, port = 'output') => [node('source', 'source', { value: literal(value) }), node('root', 'sink', { rows: literal([literal({ input: connection('source', port) })]) })];
		const run = setup(t, defs, nodes());
		const first = run.frame();
		assert.deepEqual(first.map(d => d.id), ['source', 'sink']);
		assert.equal(first[1].params.rows[0].input, first[0].outputs.output.texture);
		assert.equal(run.frame().length, 0);
		run.renderer.updateNodes(nodes(2, 'mask'));
		const second = run.frame();
		assert.equal(second[1].params.rows[0].input, second[0].outputs.mask.texture);
		const cyclic = nodes();
		cyclic[1].params.rows.value[0].value.input = connection('root');
		run.renderer.updateNodes(cyclic);
		assert.throws(() => run.frame(), /circular dependency/);
	});
	await t.test('nested image and player resources invalidate cache when their contents change', async t => {
		const defs = { media: { settings: { type: 'struct', fields: { images: { type: 'array', item: { type: 'image' } }, player: { type: 'player' } } } } };
		const run = setup(t, defs, [node('root', 'media', { settings: literal({ images: literal([literal('asset')]), player: literal('p') }) })]);
		const asset = data => ({ id: 'asset', width: 1, height: 1, fileDataType: 'image/png', data: new Uint8Array(data) });
		run.renderer.updateAssets([asset([255, 0, 0, 255])]);
		const first = run.frame()[0].params.settings;
		assert.equal(first.images[0].width, 1);
		assert.equal(first.player.videoFrame, null);
		assert.equal(run.frame().length, 0);
		run.renderer.updateAssets([asset([0, 255, 0, 255])]);
		assert.notEqual(run.frame()[0].params.settings.images[0], first.images[0]);
		const frame = { timestamp: 1, close() {} };
		run.renderer.updateVideoFrame('p', frame);
		assert.equal(run.frame()[0].params.settings.player.videoFrame, frame);
		assert.equal(run.frame().length, 0);
		const { playerAudioSourceId } = await server.ssrLoadModule('@glitch/shared/audio.ts');
		const port = { close() {}, postMessage() {} };
		run.renderer.attachAudioSource(playerAudioSourceId('p'), port);
		assert.ok(run.frame()[0].params.settings.player.audio);
		port.onmessage({ data: { type: 'samples', generation: 0, startFrame: 0, frameCount: 1024, channelCount: 1, sampleRate: 48000, buffer: new ArrayBuffer(8192) } });
		assert.equal(run.frame()[0].params.settings.player.audio.endFrame, 1024);
		assert.equal(run.frame().length, 0);
	});

	await t.test('group macros, nested group dependencies, bypass and null inputs', t => {
		const defs = { producer: { x: number }, consumer: { input: { type: 'color', canNode: true, primary: true }, nested: { type: 'struct', fields: { x: number, input: { type: 'color', canNode: true } } } } };
		const root = node('root', 'consumer', { input: connection('group'), nested: literal({ x: literal(1), input: connection(null, null) }) });
		const group = { id: 'group', type: 'group', isBypass: false, macros: [{ name: 'LOCAL', type: 'number', value: literal(6) }], nodes: [node('inside', 'producer', { x: { type: 'expression', expression: 'LOCAL' } })] };
		const run = setup(t, defs, [group, root]);
		const draws = run.frame();
		assert.equal(draws[0].params.x, 6);
		assert.equal(draws[1].params.input, draws[0].outputs.output.texture);
		assert.equal(draws[1].params.nested.input.width, 1);
		const next = structuredClone([group, root]);
		next[1].isBypass = true;
		next[1].params.nested.value.input = connection('root');
		run.renderer.updateNodes(next);
		assert.doesNotThrow(() => run.frame());
	});

	await t.test('containers reject expressions and nested invalid expressions use field fallback', t => {
		const defs = { fallback: { values: { type: 'array', item: number } } };
		const run = setup(t, defs, [node('root', 'fallback', { values: literal([{ type: 'expression', expression: '(' }]) })]);
		assert.deepEqual(run.frame()[0].params.values, [0]);
		assert.throws(() => run.renderer.updateNodes([node('root', 'fallback', { values: { type: 'expression', expression: '[1]' } })]), /must be literal/);
	});

});
