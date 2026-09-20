import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createDevice } from './helpers/gpu-device.mjs';
import { createLiveGraph, visualModule } from './helpers/live-graph.mjs';

test('expressions follow timeline seeks and live time', async t => {
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
	const { effectDefinitions: definitions } = await server.ssrLoadModule('@glitch/shared/effect-definitions.ts');
	const { effectImplementations: implementations } = await server.ssrLoadModule('@glitch/shared/effect-implementations.js');
	definitions.timeProbe = { paramDefs: { value: { type: 'number' } }, outputs: { output: { dataType: 'color', primary: true } } };
	const values = [];
	implementations.timeProbe = {
		outputTextureFactories: { output: ({ wgpu }) => wgpu.device.createTexture() },
		init: () => ({ dispose() {}, render: ctx => values.push(ctx.params.value) }),
	};
	t.after(() => { delete definitions.timeProbe; delete implementations.timeProbe; });
	const device = createDevice(false);
	const context = { configure() {}, unconfigure() {}, getCurrentTexture: () => device.createTexture() };
	const renderer = new MainRenderer({ gpuDevice: device, gpuContext: context, histogramGpuContext: context,
		waveformHorizontalGpuContext: context, waveformVerticalGpuContext: context,
		intermediateTextureFormat: 'rgba16float', resolution: { width: 16, height: 16 },
		enable32bitDataTextures: false, enableStats: false, fpsLimit: null, assets: [], automations: [] });
	t.after(() => renderer.destroy());
	const nodes = [{ id: 'probe', type: 'effect', effectId: 'timeProbe', isBypass: false,
		params: { value: { type: 'expression', expression: 'TIME' } } }];
	const module = visualModule(nodes, 'probe', definitions);
	renderer.updateVisualModules([module]);
	renderer.updateTimeline([{ id: 'layer', startTimeMs: 1000, endTimeMs: 6000,
		layer: { type: 'visualModule', visualModuleId: module.id, paramValues: {} } }]);
	for (const time of [1000, 2500, 1500, 1500]) await renderer.renderTimelineAt(time);
	assert.deepEqual(values, [0, 1.5, 0.5], 'seeks evaluate layer-local seconds and unchanged values remain cached');

	module.paramDefs = [{ id: 'amount', name: 'amount', type: 'number', typeOptions: {}, defaultValue: 0 }];
	nodes[0].params.value.expression = 'PARAM("amount") + TIME_MS + PROGRESS';
	renderer.updateVisualModules([module]);
	renderer.updateTimeline([{ id: 'layer', startTimeMs: 1000, endTimeMs: 6000,
		layer: { type: 'visualModule', visualModuleId: module.id,
			paramValues: { amount: { type: 'expression', expression: 'TIME * 2' } } } }]);
	await renderer.renderTimelineAt(2000);
	assert.equal(values.at(-1), 1002.2, 'module expressions and PARAM use AiScript values too');

	nodes[0].params.value.expression = 'TIME';
	const graph = createLiveGraph(renderer, nodes, definitions);
	const start = performance.now() + 100;
	graph.frame('probe', start);
	const initial = values.at(-1);
	for (const [factor, timestamp, expected] of [[1, 1100, 1], [2, 2100, 3], [0, 3100, 3], [0.5, 4100, 3.5]]) {
		renderer.setLiveTimeFactor(factor);
		graph.frame('probe', start + timestamp - 100);
		assert.ok(Math.abs(values.at(-1) - initial - expected) < 1e-9);
	}
});
