import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createDevice } from './helpers/gpu-device.mjs';

test('renderer graph traversal and frame history', async t => {
	const server = await createServer({
		root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
		server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom',
		optimizeDeps: { noDiscovery: true, include: [] },
		plugins: [{
			name: 'controlled-symbol-image-loading',
			resolveId(id) { if (id === 'test:symbol-images') return '\0symbol-images'; },
			load(id) {
				if (id === '\0symbol-images') return `export const requests = [];
					export function createTextureFromImages(device, urls) {
						return new Promise((resolve, reject) => requests.push({ device, urls, resolve, reject }));
					}`;
			},
			transform(code, id) {
				if (id.endsWith('/fx-implementations/symbols/main.ts')) {
					return code.replace('createTextureFromImages, ', '') + '\nimport { createTextureFromImages } from "test:symbol-images";';
				}
			},
		}],
	});
	t.after(() => server.close());
	const previousGpu = navigator.gpu;
	navigator.gpu = { getPreferredCanvasFormat: () => 'bgra8unorm' };
	t.after(() => { navigator.gpu = previousGpu; });
	const { Renderer } = await server.ssrLoadModule('/src/renderer.ts');
	const { fxImplementations } = await server.ssrLoadModule('/src/fx-implementations.ts');
	const { fxDefinitions } = await server.ssrLoadModule('@glitch/shared/fx-definitions.ts');
	const fx = (id, name, params = {}) => ({
		id, type: 'fx', fx: name, isBypass: true,
		params: {
			...Object.fromEntries(Object.entries(fxDefinitions[name].paramDefs).map(([key, param]) => [
				key, param.default(),
			])),
			...Object.fromEntries(Object.entries(params).map(([key, value]) => [key,
				fxDefinitions[name].paramDefs[key].canNode && typeof value === 'string'
					? { type: 'node', nodeId: value, outputPort: 'output' }
					: { type: 'literal', value: fxDefinitions[name].paramDefs[key].type === 'node' && typeof value === 'string' ? { nodeId: value, outputPort: 'output' } : value },
			])),
		},
	});
	const group = (id, nodes) => ({ id, type: 'group', isBypass: true, macros: [], nodes });

	function setup(t, nodes, { enableFloat32Filtering = false } = {}) {
		const device = createDevice(false);
		const textureWrites = new Map();
		device.queue.writeTexture = ({ texture }, data, layout, size) => {
			textureWrites.set(texture, { data: data.slice(), layout, size });
		};
		const passes = [];
		const statuses = new Map();
		const statusChanges = [];
		const clears = [];
		device.importExternalTexture = ({ source }) => ({ source });
		let canvasInput;
		// Keep the real Renderer and effects; record texture bindings at the GPU boundary.
		device.createBindGroup = descriptor => descriptor;
		const createEncoder = device.createCommandEncoder;
		device.createCommandEncoder = () => {
			const encoder = createEncoder();
			const beginPass = encoder.beginRenderPass;
			encoder.beginRenderPass = descriptor => {
				const pass = beginPass(descriptor);
				const output = descriptor.colorAttachments[0].view.texture;
				if (!output.canvas && descriptor.colorAttachments[0].loadOp === 'clear') {
					clears.push(descriptor.colorAttachments[0]);
				}
				const inputs = [];
				pass.setBindGroup = (_, bindGroup) => {
					for (const { resource } of bindGroup.entries) {
						if (resource.texture) inputs.push(resource.texture);
					}
				};
				pass.draw = () => {
					assert.ok(!inputs.includes(output), 'a render pass must not read its output texture');
					if (!output.canvas) passes.push({ output, inputs: [...inputs] });
					else if (inputs.length > 0) canvasInput = inputs[0];
				};
				return pass;
			};
			return encoder;
		};
		const context = {
			configure() {}, unconfigure() {},
			getCurrentTexture: () => Object.assign(device.createTexture(), { canvas: true }),
		};
		const renderer = new Renderer({
			gpuDevice: device, gpuContext: context, histogramGpuContext: context, waveformGpuContext: context,
			resolution: { width: 64, height: 64 }, enableFloat32Filtering, enableStats: false,
			fpsLimit: null, assets: [], macros: [], automations: [], nodes,
			onEffectStatus: (id, status) => {
				statusChanges.push({ id, status });
				if (status) statuses.set(id, status);
				else statuses.delete(id);
			},
		});
		t.after(() => renderer.destroy());
		let time = performance.now();
		return {
			renderer,
			textureWrites,
			statuses, statusChanges,
			clears,
			get canvasInput() { return canvasInput; },
			frame(id = 'root') {
				passes.length = 0;
				clears.length = 0;
				renderer.render(id, { time: time += 16 });
				return [...passes];
			},
		};
	}

	const disabled = node => ({ ...node, isBypass: false });

	for (const enableFloat32Filtering of [true, false]) {
		const precision = enableFloat32Filtering ? '32' : '16';
		await t.test(`canNode uploads vector XY and scalar values as float${precision}`, t => {
			const source = fx('source', 'fill');
			const run = setup(t, [source, fx('root', 'transform', { input: 'source' })], { enableFloat32Filtering });
			function assertUpload(texture, channels, expected) {
				assert.equal(texture.format, `${channels}${precision}float`);
				assert.equal(texture.width, 1);
				assert.equal(texture.height, 1);
				const upload = run.textureWrites.get(texture);
				assert.ok(upload, 'the texture bound to the effect must receive the parameter value');
				assert.ok(upload.data instanceof (enableFloat32Filtering ? Float32Array : Uint16Array));
				assert.deepEqual([...upload.data], expected);
				assert.equal(upload.layout.bytesPerRow, expected.length * (enableFloat32Filtering ? 4 : 2));
				assert.deepEqual(upload.size, { width: 1, height: 1 });
			}
			let inputs = run.frame().at(-1).inputs;
			// 初期値[0, 0]をスカラーへ変換するとNaNになる不具合の回帰テスト。
			assertUpload(inputs[1], 'rg', [0, 0]);
			assertUpload(inputs[2], 'rg', enableFloat32Filtering ? [1, 1] : [0x3c00, 0x3c00]);
			assertUpload(inputs[3], 'r', [0]);

			run.renderer.updateNodes([source, fx('root', 'transform', {
				input: 'source', translation: [-0.5, 0.25], scale: [-1, 0.5], rotation: -90,
			})]);
			inputs = run.frame().at(-1).inputs;
			// 16bitの期待値はIEEE 754 binary16のビット列。変換関数を期待値に流用しない。
			assertUpload(inputs[1], 'rg', enableFloat32Filtering ? [-0.5, 0.25] : [0xb800, 0x3400]);
			assertUpload(inputs[2], 'rg', enableFloat32Filtering ? [-1, 0.5] : [0xbc00, 0x3800]);
			assertUpload(inputs[3], 'r', [enableFloat32Filtering ? -90 : 0xd5a0]);
		});
	}

	await t.test('symbols caches async output, ignores obsolete loads and releases textures', async t => {
		const { requests } = await server.ssrLoadModule('test:symbol-images');
		const nodes = (iconset = 'symbols', input = 'a') => [
			fx('a', 'fill'), fx('b', 'fill'), fx('symbols', 'symbols', { iconset, input }),
			fx('root', 'multiply', { input: 'symbols' }),
		];
		const run = setup(t, nodes());
		const settle = () => new Promise(resolve => setImmediate(resolve));
		async function complete(index) {
			const texture = requests[index].device.createTexture();
			const destroy = t.mock.method(texture, 'destroy');
			requests[index].resolve(texture);
			await settle();
			return { texture, destroy };
		}
		run.frame();
		assert.equal(run.statuses.get('symbols')?.type, 'loading');
		assert.equal(run.frame().length, 0, 'loading output is cached');
		const first = await complete(0);
		assert.equal(run.statuses.get('symbols')?.type, 'ready', 'completion is reported without rendering');
		let passes = run.frame();
		assert.equal(passes.length, 2, 'completion invalidates symbols and downstream');
		assert.equal(passes[0].inputs[1], first.texture);
		assert.equal(run.frame().length, 0);

		run.renderer.updateNodes(nodes('numbers'));
		run.frame();
		run.renderer.updateNodes(nodes('sweets', 'b'));
		passes = run.frame();
		const latestInput = passes[0].output;
		const latest = await complete(2);
		passes = run.frame();
		assert.equal(passes.length, 2);
		assert.equal(passes[0].inputs[0], latestInput, 'completion retains the latest input');
		assert.equal(passes[0].inputs[1], latest.texture);
		assert.equal(first.destroy.mock.callCount(), 1);
		const obsolete = await complete(1);
		assert.equal(obsolete.destroy.mock.callCount(), 1);
		assert.equal(run.frame().length, 0, 'obsolete completion cannot replace cached output');

		run.renderer.updateNodes(nodes('symbols'));
		run.frame();
		const errors = t.mock.method(console, 'error', () => {});
		requests[3].reject(new Error('image load failed'));
		await settle();
		assert.equal(errors.mock.callCount(), 1);
		assert.deepEqual(run.statuses.get('symbols'), { type: 'error', message: 'image load failed' });
		assert.equal(run.frame().length, 0, 'failed loads retain cached output');
		run.renderer.updateNodes(nodes('numbers'));
		run.frame();
		run.renderer.updateNodes([]);
		assert.equal(latest.destroy.mock.callCount(), 1);
		const disposed = await complete(4);
		assert.equal(run.statuses.has('symbols'), false);
		assert.equal(disposed.destroy.mock.callCount(), 1, 'completion after disposal releases its texture');
	});

	await t.test('effect status is reported on initialization and explicit updates only', t => {
		const run = setup(t, [fx('root', 'multiply'), fx('unused', 'fill')]);
		const reports = [];
		const originalInit = fxImplementations.multiply.init;
		t.mock.method(fxImplementations.multiply, 'init', args => {
			reports.push(args.reportStatus);
			const instance = originalInit(args);
			return { ...instance, render(ctx) {
				assert.deepEqual(run.statuses.get('root'), { type: 'ready' }, 'synchronous initialization reports ready before rendering');
				instance.render(ctx);
			} };
		});
		run.frame();
		assert.deepEqual(run.statuses.get('root'), { type: 'ready' });
		assert.equal(run.statuses.has('unused'), false, 'uninitialized nodes stay idle');
		reports[0]({ type: 'loading' });
		const count = run.statusChanges.length;
		reports[0]({ type: 'loading' });
		assert.equal(run.statusChanges.length, count);
		assert.equal(run.frame().length, 0, 'status changes do not invalidate cached output');
		reports[0]({ type: 'error', message: 'first error' });
		assert.equal(run.statusChanges.length, count + 1);
		reports[0]({ message: 'first error', type: 'error' });
		assert.equal(run.statusChanges.length, count + 1, 'identical errors are deduplicated regardless of property order');
		reports[0]({ type: 'error', message: 'second error' });
		assert.equal(run.statusChanges.length, count + 2, 'changed error messages are reported');
		reports[0]({ type: 'ready' });
		assert.equal(run.statusChanges.length, count + 3, 'recovery is reported');
		reports[0]({ type: 'ready' });
		assert.equal(run.statusChanges.length, count + 3);
		run.renderer.updateNodes([]);
		run.renderer.updateNodes([fx('root', 'multiply')]);
		run.frame();
		reports[0]({ type: 'error', message: 'obsolete' });
		assert.deepEqual(run.statuses.get('root'), { type: 'ready' });
		t.mock.method(run.renderer, 'startRenderLoop', () => {});
		run.renderer.resize({ width: 32, height: 32 });
		reports[1]({ type: 'loading' });
		assert.equal(run.statuses.has('root'), false, 'resize clears status and rejects old reports');
		run.frame();
		assert.deepEqual(run.statuses.get('root'), { type: 'ready' });
	});

	await t.test('video caches shared player frames and invalidates downstream on updates', t => {
		const nodes = (player = 'player', sizeMode = 1) => [
			fx('a', 'video', { player, sizeMode }), fx('b', 'video', { player }),
			fx('root', 'colorMix', { inputA: 'a', inputB: 'b' }),
		];
		const run = setup(t, nodes());
		let closes = 0;
		const newFrame = () => ({ timestamp: 0, close() { closes++; } });
		run.renderer.updateVideoFrame('player', newFrame());
		assert.equal(run.frame().length, 3);
		assert.equal(run.frame().length, 0, 'unchanged frame and downstream output are cached');
		run.renderer.updateVideoFrame('other', newFrame());
		assert.equal(run.frame().length, 0, 'unreferenced players do not invalidate output');
		run.renderer.updateVideoFrame('player', newFrame());
		assert.equal(closes, 1);
		assert.equal(run.frame().length, 3, 'new frames invalidate both consumers even with the same timestamp');
		assert.equal(run.frame().length, 0);
		run.renderer.updateNodes(nodes('player', 2));
		assert.equal(run.frame().length, 2, 'size mode invalidates video and downstream');
		run.renderer.updateNodes(nodes('other', 2));
		assert.equal(run.frame().length, 3, 'switching players invalidates output');
		assert.equal(run.frame().length, 0);
	});

	await t.test('video clears absent frames once and redraws after removal and restoration', t => {
		const run = setup(t, [fx('video', 'video', { player: 'player' }), fx('root', 'multiply', { input: 'video' })]);
		for (const frame of [null, { close() {} }, null, { close() {} }]) {
			run.renderer.updateVideoFrame('player', frame);
			assert.equal(run.frame().length, frame ? 2 : 1);
			assert.equal(run.clears.length, 2, 'video output is cleared even without a frame');
			if (!frame) assert.deepEqual(run.clears[0].clearValue, { r: 0, g: 0, b: 0, a: 0 });
			assert.equal(run.frame().length, 0);
			assert.equal(run.clears.length, 0, 'transparent output is cached too');
		}
	});

	for (const name of ['colorBlend', 'colorMix', 'dataBlend', 'dataMix']) {
		await t.test(`${name} preserves output precision and renders node-driven amount`, t => {
			const run = setup(t, [fx('a', 'fill'), fx('b', 'fill'), fx('weight', 'multiply'), fx('root', name, { inputA: 'a', inputB: 'b', amount: 'weight' })]);
			const passes = run.frame();
			assert.equal(passes.length, 4);
			assert.equal(passes[3].output.format, name.startsWith('data') ? 'rgba32float' : 'rgba16float');
			assert.deepEqual(passes[3].inputs, passes.slice(0, 3).map(pass => pass.output));
			assert.equal(run.frame().length, 0);
		});
	}

	await t.test('bypasses middle and final nodes, follows live input and restores cached output', t => {
		const a = fx('a', 'multiply', { v: 2 });
		const b = fx('b', 'multiply', { input: 'a', v: 3 });
		const c = fx('root', 'multiply', { input: 'b', v: 4 });
		const run = setup(t, [a, b, c]);
		const initial = run.frame();
		run.renderer.updateNodes([a, disabled(b), c]);
		const bypass = run.frame();
		assert.equal(bypass.length, 1);
		assert.equal(bypass[0].inputs[0], initial[0].output);
		run.renderer.updateNodes([a, b, disabled(c)]);
		run.frame();
		assert.equal(run.canvasInput, initial[1].output);
		run.renderer.updateNodes([a, disabled(b), disabled(c)]);
		run.frame();
		assert.equal(run.canvasInput, initial[0].output);
		run.renderer.updateNodes([fx('a', 'multiply', { v: 5 }), disabled(b), c]);
		assert.equal(run.frame().length, 2, 'input changes invalidate downstream cache');
		run.renderer.updateNodes([a, b, c]);
		assert.equal(run.frame().length, 1, 'unchanged enabled effects may reuse their retained output');
		assert.equal(run.canvasInput, initial[2].output);
		assert.equal(run.frame().length, 0);
	});

	await t.test('retains frame history while an effect is disabled', t => {
		const trail = fx('root', 'pointerTrail');
		const run = setup(t, [trail]);
		const first = run.frame()[0];
		run.renderer.updateNodes([disabled(trail)]);
		assert.equal(run.frame().length, 0);
		run.renderer.updateNodes([trail]);
		const resumed = run.frame()[0];
		assert.equal(resumed.inputs[0], first.output);
		assert.equal(resumed.output, first.inputs[0]);
	});

	await t.test('disabled unconnected effects and groups supply fallback to downstream nodes', t => {
		for (const input of [fx('input', 'multiply'), group('input', [fx('child', 'pointerTrail')])]) {
			const run = setup(t, [disabled(input), fx('root', 'multiply', { input: 'input' })]);
			const passes = run.frame();
			assert.equal(passes.length, 1);
			assert.equal(passes[0].inputs[0].width, 1);
			assert.equal(run.frame().length, 0, 'disabled dynamic descendants do not invalidate cache');
		}
	});

	await t.test('switching a group output to an identical node invalidates downstream cache', t => {
		const a = fx('a', 'multiply');
		const b = fx('b', 'multiply');
		const root = fx('root', 'multiply', { input: 'g' });
		const run = setup(t, [group('g', [a, b]), root]);
		const first = run.frame();
		run.renderer.updateNodes([group('g', [b, a]), root]);
		const second = run.frame();
		assert.equal(second.length, 2);
		assert.notEqual(second[1].inputs[0], first[1].inputs[0]);
	});

	await t.test('disabled blur ignores secondary dependencies and their cycles', t => {
		const run = setup(t, [fx('a', 'pointerTrail'), disabled(fx('b', 'blur', { input: 'a', amount: 'b' })), fx('root', 'multiply', { input: 'b' })]);
		for (let i = 0; i < 2; i++) {
			const passes = run.frame();
			assert.equal(passes.length, 2);
			assert.equal(passes[1].inputs[0], passes[0].output);
		}
	});

	await t.test('disabled generators and groups publish fallback instead of stale output', t => {
		for (const root of [fx('root', 'pointerTrail'), group('root', [fx('child', 'pointerTrail')])]) {
			const run = setup(t, [root]);
			run.frame();
			const previous = run.canvasInput;
			run.renderer.updateNodes([disabled(root)]);
			assert.equal(run.frame().length, 0);
			assert.notEqual(run.canvasInput, previous);
			assert.equal(run.canvasInput.width, 1);
		}
	});

	await t.test('nested groups resolve disabled final children and scalar inputs use fallback', t => {
		const run = setup(t, [fx('a', 'multiply'), group('g', [group('inner', [disabled(fx('b', 'multiply', { input: 'a' }))])]), disabled(fx('empty', 'pointerTrail')), fx('root', 'blur', { input: 'g', amount: 'empty' })]);
		const passes = run.frame();
		assert.equal(passes.length, 2);
		assert.equal(passes[1].inputs[0], passes[0].output);
		assert.equal(passes[1].inputs[1].format, 'r16float');
		assert.equal(passes[1].inputs[1].width, 1);
	});

	await t.test('disabled primary cycles are rejected', t => {
		const { frame } = setup(t, [disabled(fx('root', 'multiply', { input: 'other' })), disabled(fx('other', 'multiply', { input: 'root' }))]);
		assert.throws(() => frame(), /circular dependency detected/);
	});

	for (const grouped of [false, true]) {
		await t.test(`shared ${grouped ? 'group' : 'node'} renders once per frame and publishes alternating history`, t => {
			const trail = fx('trail', 'pointerTrail');
			const shared = fx('shared', 'multiply', { input: 'trail' });
			const input = grouped ? 'group' : 'shared';
			const nodes = grouped ? [group('group', [trail, shared])] : [trail, shared];
			nodes.push(fx('root', 'blur', { input, amount: input }));
			const { frame } = setup(t, nodes);
			const first = frame();
			assert.equal(first.length, 3, 'trail, shared and root each draw once');
			assert.equal(first[0].output.format, 'rg16float');
			assert.equal(first[1].inputs[0], first[0].output, 'downstream reads this frame');
			assert.deepEqual(first[2].inputs, [first[1].output, first[1].output]);
			const second = frame();
			assert.equal(second.length, 3, 'rendered set resets on the next frame');
			assert.equal(second[0].inputs[0], first[0].output);
			assert.equal(second[0].output, first[0].inputs[0]);
			assert.equal(second[1].inputs[0], second[0].output);
			const third = frame();
			assert.equal(third[0].output, first[0].output);
			assert.equal(third[0].inputs[0], second[0].output);
		});
	}

	for (const [name, nodes] of [
		['self reference', [fx('root', 'multiply', { input: 'root' })]],
		['two-node cycle', [fx('root', 'multiply', { input: 'other' }), fx('other', 'multiply', { input: 'root' })]],
		['group cycle', [group('root', [fx('child', 'multiply', { input: 'root' })])]],
		// Dynamic dependencies make evalCacheKey return null before reaching the cycle.
		// This exercises renderNode's own cycle detection, not only evalCacheKey's.
		['cycle with uncached input', [fx('trail', 'pointerTrail'), fx('root', 'blur', { input: 'trail', amount: 'root' })]],
	]) {
		await t.test(`rejects ${name}`, t => {
			const { frame } = setup(t, nodes);
			assert.throws(() => frame(), /circular dependency detected/);
		});
	}

	await t.test('static output is cached across frames and parameter changes invalidate it', t => {
		const { renderer, frame } = setup(t, [fx('root', 'multiply', { input: null, v: 2 })]);
		const first = frame();
		assert.equal(first.length, 1);
		assert.equal(frame().length, 0);
		renderer.updateNodes([fx('root', 'multiply', { input: null, v: 3 })]);
		const changed = frame();
		assert.equal(changed.length, 1);
		assert.equal(changed[0].output, first[0].output, 'ordinary effects retain their output');
	});

	for (const operation of ['resize', 'remove and restore']) {
		await t.test(`${operation} redraws static image output and downstream effects`, t => {
			const nodes = [fx('image', 'image', { image: 'asset' }), fx('root', 'multiply', { input: 'image', v: 2 })];
			const run = setup(t, nodes);
			run.renderer.updateAssets([{ id: 'asset', fileDataType: 'image/png', width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }]);
			t.mock.method(run.renderer, 'startRenderLoop', () => {});
			let previous = run.frame();
			assert.equal(previous.length, 2);
			assert.equal(run.frame().length, 0);
			for (const size of [32, 64]) {
				if (operation === 'resize') {
					run.renderer.resize({ width: size, height: size });
				} else {
					run.renderer.updateNodes([]);
					run.renderer.updateNodes(nodes);
				}
				const passes = run.frame();
				assert.equal(passes.length, 2, 'new output textures must be drawn before they can be cached');
				for (let i = 0; i < passes.length; i++) {
					assert.notEqual(passes[i].output, previous[i].output);
					assert.equal(passes[i].output.width, operation === 'resize' ? size : 64);
					assert.equal(passes[i].output.height, operation === 'resize' ? size : 64);
				}
				assert.equal(passes[0].inputs[0], previous[0].inputs[0], 'the source asset is retained');
				assert.equal(passes[1].inputs[0], passes[0].output);
				assert.equal(run.canvasInput, passes[1].output);
				assert.equal(run.frame().length, 0, 'unchanged frames reuse the new output');
				previous = passes;
			}
		});
	}

	await t.test('bloom scales its fine detail with resolution while retaining the halo pyramid', t => {
		const run = setup(t, [fx('input', 'fill'), fx('root', 'bloom', { input: 'input' })]);
		t.mock.method(run.renderer, 'startRenderLoop', () => {});
		let previous = run.frame();
		assert.equal(previous.length, 13);
		assert.equal(run.frame().length, 0);
		for (const [width, height, gridWidth, gridHeight] of [
			[1920, 1080, 960, 540], [3840, 2160, 1920, 1080],
			[1080, 1920, 540, 960], [270, 480, 288, 512], [64, 64, 512, 512],
		]) {
			run.renderer.resize({ width, height });
			const passes = run.frame();
			assert.ok(passes.length >= 13);
			for (const pass of passes) {
				assert.ok(!previous.some(old => old.output === pass.output), 'resize replaces render targets');
			}
			for (const pass of [passes[0], passes.at(-1)]) {
				assert.deepEqual([pass.output.width, pass.output.height], [width, height]);
			}
			assert.deepEqual([passes[1].output.width, passes[1].output.height], [gridWidth, gridHeight]);
			const coarsest = passes[(passes.length - 1) / 2].output;
			assert.equal(Math.max(coarsest.width, coarsest.height), 16, 'halo extent does not shrink at higher resolutions');
			assert.equal(passes[1].inputs[0], passes[0].output, 'prefilter uses the resized input');
			assert.deepEqual(passes.at(-1).inputs, [passes[0].output, passes[1].output]);
			assert.equal(run.canvasInput, passes.at(-1).output);
			assert.equal(run.frame().length, 0, 'new output is cached only after rendering');
			previous = passes;
		}
	});

	await t.test('bloom changes quality live, releases the previous pyramid and reuses unchanged resources', t => {
		const nodes = quality => [fx('input', 'fill'), fx('root', 'bloom', { input: 'input', quality })];
		const run = setup(t, nodes(0.5));
		t.mock.method(run.renderer, 'startRenderLoop', () => {});
		run.renderer.resize({ width: 2048, height: 1024 });
		let previous = run.frame().slice(1);
		for (const [quality, expectedWidth] of [[1, 2048], [0.25, 512], [0.5, 1024], [NaN, 1024], [0, 512], [2, 2048]]) {
			const oldTargets = [...new Set(previous.slice(0, -1).map(pass => pass.output))];
			const destroys = oldTargets.map(texture => t.mock.method(texture, 'destroy'));
			run.renderer.updateNodes(nodes(quality));
			const passes = run.frame();
			assert.deepEqual([passes[0].output.width, passes[0].output.height], [expectedWidth, expectedWidth / 2]);
			const changed = expectedWidth !== previous[0].output.width;
			for (const destroy of destroys) assert.equal(destroy.mock.callCount(), changed ? 1 : 0);
			assert.equal(passes.at(-1).output, previous.at(-1).output, 'quality does not replace the full resolution output');
			assert.equal(passes.at(-1).inputs[1], passes[0].output, 'composite binds the current pyramid');
			assert.equal(passes[0].inputs[0], previous[0].inputs[0], 'input remains unchanged');
			previous = passes;
		}
	});

	await t.test('empty groups and absent output nodes do not draw', t => {
		const { frame } = setup(t, [group('root', [])]);
		assert.deepEqual(frame(), []);
		assert.deepEqual(frame('missing'), []);
	});
});
