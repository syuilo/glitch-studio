import vertex from '@gs/shared/gpu/vertex.wgsl';
import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { nativeEffectDefinitions } from '../src/definitions.ts';
import { nativeEffectImplementations } from '../src/implementations.ts';

const native = id => ({ type: 'nativeEffect', id });
const inlineGraph = customNodeGraphEffect => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect });
const literal = value => ({ inputSource: 'literal', value });
const wire = (nodeId, outputPort) => ({ inputSource: 'node', source: { nodeId, outputPort }, sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' } });
const publicParameter = parameterId => ({ inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId });
const size = { width: 32, height: 16 };

function check(ok, reason) {
	if (!ok) throw new Error(reason);
}

function near(actual, expected, reason, tolerance = 0.002) {
	check(Math.abs(actual - expected) <= tolerance, reason + ': ' + actual + ' != ' + expected);
}

async function withGpu(run, measure = false) {
	const adapter = await navigator.gpu.requestAdapter();
	const requiredFeatures = measure && adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
	const device = await adapter.requestDevice({ requiredFeatures });
	device.pushErrorScope('validation');
	try {
		const gpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertex }), enable32bitDataTextures: false };
		const definitions = { getNativeEffect: id => nativeEffectDefinitions[id] };
		const textures = [];
		const allocate = device.createTexture.bind(device);
		device.createTexture = descriptor => {
			const texture = allocate(descriptor);
			textures.push(texture);
			return texture;
		};
		let pipelineCount = 0;
		const compile = device.createRenderPipelineAsync.bind(device);
		device.createRenderPipelineAsync = descriptor => { pipelineCount++; return compile(descriptor); };
		let bindGroupCount = 0;
		const createBindGroup = device.createBindGroup.bind(device);
		device.createBindGroup = descriptor => { bindGroupCount++; return createBindGroup(descriptor); };
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const reader = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: {
			module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> pixels: array<vec4f>;
@compute @workgroup_size(1) fn read(@builtin(global_invocation_id) id: vec3u) {
	pixels[id.y * textureDimensions(image).x + id.x] = textureLoad(image, id.xy, 0);
}` }),
		} });
		await run({
			gpu, textures, pipelines: () => pipelineCount, bindGroups: () => bindGroupCount,
			create: (effectSource, ports, inputs = {}, options = {}) => createEffectInstance({
				effectSource, definitions, resolution: { width: 4, height: 4 }, usedOutputPorts: new Set(ports), inputs, ...options,
			}, gpu, id => nativeEffectImplementations[id]),
			render(instance, timeDelta = 0) {
				const encoder = device.createCommandEncoder();
				const begin = encoder.beginRenderPass.bind(encoder);
				let passCount = 0;
				encoder.beginRenderPass = descriptor => { passCount++; return begin(descriptor); };
				instance.render({ commandEncoder: encoder, time: 0, timeDelta });
				device.queue.submit([encoder.finish()]);
				return passCount;
			},
			async read(texture) {
				const bytes = texture.width * texture.height * 16;
				const storage = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
				const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
				try {
					const encoder = device.createCommandEncoder();
					const pass = encoder.beginComputePass();
					pass.setPipeline(reader);
					pass.setBindGroup(0, device.createBindGroup({ layout, entries: [
						{ binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer: storage } },
					] }));
					pass.dispatchWorkgroups(texture.width, texture.height);
					pass.end();
					encoder.copyBufferToBuffer(storage, 0, staging, 0, bytes);
					device.queue.submit([encoder.finish()]);
					await staging.mapAsync(GPUMapMode.READ);
					return new Float32Array(staging.getMappedRange()).slice();
				} finally {
					staging.destroy();
					storage.destroy();
				}
			},
		});
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
	} finally {
		device.destroy();
	}
}

export async function vignette() {
	const definition = nativeEffectDefinitions.vignette;
	const child = { ...definition, paramDefs: {}, resolutionInputParameters: [], nodes: [
		{ id: 'image', effectSource: native('fill'), resolution: size, params: { color: literal([4, -2, 0.5, 0.5]) } },
		{ id: 'shade', effectSource: native('vignette'), params: { input: wire('image', 'output'), strength: literal(0.75), size: literal([0.5, 0.5]) } },
	], outputSources: { output: { nodeId: 'shade', outputPort: 'output' }, mask: { nodeId: 'shade', outputPort: 'mask' } } };
	const parent = { ...child, nodes: [{ id: 'child', effectSource: inlineGraph(child), params: {} }],
		outputSources: { output: { nodeId: 'child', outputPort: 'output' }, mask: { nodeId: 'child', outputPort: 'mask' } } };
	await withGpu(async ({ create, render, read, textures, gpu }) => {
		let colorOnly, maskOnly;
		for (const ports of [['output'], ['mask'], ['mask', 'output']]) {
			const before = textures.length;
			gpu.enable32bitDataTextures = ports.length === 2;
			const instance = await create(inlineGraph(parent), ports);
			try {
				const hasColor = ports.includes('output');
				const hasMask = ports.includes('mask');
				check(textures.length - before === Number(hasColor) * 2 + Number(hasMask), 'unused output or upstream texture allocated');
				check(render(instance) === (hasColor ? 2 : 1), 'one Vignette pass and only the required upstream');
				for (const port of ports) {
					const output = instance.outputs.get(port);
					check(output.resolution.width === size.width && output.resolution.height === size.height, 'size from upstream metadata');
					const expectedFormat = port === 'output' ? 'rgba16float' : gpu.enable32bitDataTextures ? 'r32float' : 'r16float';
					check(output.texture.format === expectedFormat, 'format for ' + port);
					const pixels = await read(output.texture);
					if (ports.length === 1) {
						if (hasColor) colorOnly = pixels; else maskOnly = pixels;
					} else {
						const single = port === 'output' ? colorOnly : maskOnly;
						pixels.forEach((x, i) => near(x, single[i], 'single/MRT pixel'));
					}
				}
			} finally { instance.dispose(); }
		}
		near(maskOnly[0], 1, 'outer mask');
		near(maskOnly[4 * (size.width * 8 + 16)], 0, 'center mask');
		check(maskOnly.some((v, i) => i % 4 === 0 && v > 0 && v < 1), 'feather transition');
		for (let i = 0; i < colorOnly.length; i += 4) {
			const factor = 1 - 0.75 * maskOnly[i];
			[2 * factor, -factor, 0.25 * factor, 0.5].forEach((v, c) => near(colorOnly[i + c], v, 'premultiplied HDR'));
		}
	});
}

export async function vignetteIntoFeedback() {
	await withGpu(async ({ create, render, read }) => {
		const definition = nativeEffectDefinitions.vignette;
		const graph = { ...definition, paramDefs: { input: definition.paramDefs.input }, nodes: [
			{ id: 'shade', effectSource: native('vignette'), resolution: size, params: { input: publicParameter('input'), center: literal([0.18, 0.08]) } },
			{ id: 'history', effectSource: native('feedback'), params: { input: wire('shade', 'output'), mode: literal('interpolate'), halfLife: literal(1000) } },
		], outputDefs: { color: definition.outputDefs.output, history: nativeEffectDefinitions.feedback.outputDefs.output },
		outputSources: { color: { nodeId: 'shade', outputPort: 'output' }, history: { nodeId: 'history', outputPort: 'output' } } };
		let color = [2, -1, 0.25, 0.5];
		const instance = await create(inlineGraph(graph), ['color', 'history'], { input: { kind: 'uniform', get value() { return color; } } });
		try {
			render(instance, 1000);
			const image = await read(instance.outputs.get('color').texture);
			const history = instance.outputs.get('history');
			const first = await read(history.texture);
			const center = 4 * (size.width * 5 + 21);
			check(image[0] < image[center], 'spatially varying input');
			color.forEach((value, i) => near(image[center + i], value, 'preserve premultiplied uniform'));
			image.forEach((value, i) => near(first[i], value, 'first frame copies the input pixel'));
			color = [0, 0, 0, 0];
			render(instance, 1000);
			const second = await read(history.texture);
			image.forEach((value, i) => near(second[i], value * 0.5, 'history decays at the same pixel'));
		} finally { instance.dispose(); }
	});
}

export async function tiledHistory() {
	await withGpu(async ({ create, render, read, gpu }) => {
		const definition = nativeEffectDefinitions.feedback;
		const graph = inlineGraph({ ...definition, nodes: [
			{ id: 'shade', effectSource: native('vignette'), params: { input: literal([2, -1, 0.5, 0.5]) } },
			{ id: 'history', effectSource: native('feedback'), params: { input: wire('shade', 'output'), mode: literal('interpolate') } },
		], outputSources: { output: { nodeId: 'history', outputPort: 'output' } } });
		const reports = [];
		const plainPaths = new Set();
		const measured = Promise.withResolvers();
		const plain = await create(graph, ['output'], {}, {
			onGpuTime(path) {
				plainPaths.add(path.join('/'));
				if (plainPaths.has('shade') && plainPaths.has('history')) measured.resolve();
			},
		});
		const tiled = await create(graph, ['output'], {}, {
			tiling: { mode: 'manual', tileSize: 2 },
			onGpuTime(path, index, time) { reports.push([path.join('/'), index, time]); },
		});
		const frame = { time: 1, timeDelta: 500 };
		try {
			render(plain, 500);
			const expected = await read(plain.outputs.get('output').texture);
			await measured.promise;
			const controller = new AbortController();
			let aborted = false;
			try {
				await tiled.renderTiled(frame, controller.signal, progress => {
					if (progress?.completedTiles === 1) controller.abort();
				});
			} catch (error) { aborted = error.name === 'AbortError'; }
			check(aborted, 'abort between submitted tiles');
			let completed = 0;
			await tiled.renderTiled(frame, undefined, progress => {
				if (progress?.completedTiles === 4) completed++;
			});
			check(completed === 2, 'both placements completed all four tiles');
			const actual = await read(tiled.outputs.get('output').texture);
			expected.forEach((v, i) => near(actual[i], v, 'resumed tiled pixel'));
			check(reports.length === 2 && reports.every(([path, pass, ms]) => ['shade', 'history'].includes(path) && pass === 0 &&
				(gpu.device.features.has('timestamp-query') ? Number.isFinite(ms) && ms >= 0 : ms === null)), 'per-pass GPU statistics');
			await tiled.renderTiled(frame);
			check(reports.length === 3 && reports[2][0] === 'history', 'cache the static upstream while advancing history');
		} finally { tiled.dispose(); plain.dispose(); }
	}, true);
}

export async function automaticTiling() {
	await withGpu(async ({ create, render, read }) => {
		const shader = {
			kind: 'generate', shaderApiVersion: 1, canHaveLongRunningRenderPass: true,
			primaryInputParameter: null, primaryOutput: 'image', resolutionInputParameters: [], paramDefs: {},
			outputDefs: { image: { dataType: { kind: 'color' }, nameForReference: 'image' } },
			code: 'fn main(p: vec2f) -> Output { return Output(vec4f(p.x, p.y, 0.5, 1.0)); }',
		};
		const source = { type: 'inlineCustomShaderEffect', customShaderEffect: shader };
		const resolution = { width: 257, height: 129 };
		const timings = [];
		const options = { resolution, onGpuTime: (_path, pass, ms) => timings.push([pass, ms]) };
		const plain = await create(source, ['image'], {}, options);
		const automatic = await create(source, ['image'], {}, { ...options, tiling: { mode: 'auto' } });
		try {
			render(plain);
			let last = null;
			await automatic.renderTiled({ time: 0, timeDelta: 0 }, undefined, progress => { if (progress != null) last = progress; });
			check(last != null && last.completedTiles === last.totalTiles && last.totalTiles > 1, 'subdivide the full render pass without timestamp queries');
			check(timings.length === 2 && timings.every(([index, time]) => index === 0 && time === null), 'explicitly report unavailable timestamps');
			const expected = await read(plain.outputs.get('image').texture);
			const actual = await read(automatic.outputs.get('image').texture);
			expected.forEach((v, i) => near(actual[i], v, 'automatic tile pixel'));
		} finally { automatic.dispose(); plain.dispose(); }
	});
}

export async function feedback() {
	await withGpu(async ({ create, render, read, textures, gpu, pipelines, bindGroups }) => {
		const definition = nativeEffectDefinitions.feedback;
		const sample = definition.paramDefs.input;
		const shader = { kind: 'generate', shaderApiVersion: 1, primaryInputParameter: null, primaryOutput: 'sum', resolutionInputParameters: [],
			paramDefs: { a: { ...sample, nameForReference: 'a' }, b: { ...sample, nameForReference: 'b' } },
			outputDefs: { sum: { dataType: { kind: 'any' }, nameForReference: 'sum' } },
			code: 'fn main(p: vec2f) -> Output { return Output(read_a(p) + read_b(p)); }' };
		const child = { ...definition, nodes: [{ id: 'history', effectSource: native('feedback'), params: {
			input: publicParameter('input'), mode: literal('interpolate'), halfLife: literal(1000),
		} }], outputSources: { output: { nodeId: 'history', outputPort: 'output' } } };
		const graph = { ...child, nodes: [
			{ id: 'first', effectSource: inlineGraph(child), params: { input: publicParameter('input') } },
			{ id: 'second', effectSource: inlineGraph(child), params: { input: literal([-3, 0, 0, 0]) } },
			{ id: 'sum', effectSource: { type: 'inlineCustomShaderEffect', customShaderEffect: shader }, params: { a: wire('first', 'output'), b: wire('first', 'output') } },
		], outputDefs: { first: definition.outputDefs.output, second: definition.outputDefs.output, sum: shader.outputDefs.sum },
		outputSources: { first: { nodeId: 'first', outputPort: 'output' }, second: { nodeId: 'second', outputPort: 'output' }, sum: { nodeId: 'sum', outputPort: 'sum' } } };
		let input = 4;
		const instance = await create(inlineGraph(graph), ['sum', 'first', 'second'], { input: { kind: 'uniform', get value() { return [input, 0, 0, 0]; } } });
		try {
			const first = instance.outputs.get('first');
			const initialTexture = first.texture;
			let previousTexture = initialTexture;
			for (const [index, expected] of [4, 2, 1, 8].entries()) {
				if (index === 1) input = 0;
				if (index === 3) { input = 8; instance.resetRenderHistory(); }
				const groupsBeforeRender = bindGroups();
				check(render(instance, 1000) === 3, 'draw each placement once');
				if (index >= 2) check(bindGroups() === groupsBeforeRender, 'reuse downstream bindings for both history textures');
				check(first.texture !== previousTexture && (index % 2 === 1) === (first.texture === initialTexture), 'two alternating targets');
				previousTexture = first.texture;
				near((await read(first.texture))[0], expected, 'interpolation history');
				near((await read(instance.outputs.get('sum').texture))[0], expected * 2, 'both downstream bindings see current frame');
				near((await read(instance.outputs.get('second').texture))[0], -3, 'independent sibling history');
			}
			check(textures.length === 5 && pipelines() === 3, 'reuse allocations and pipelines across reset');
		} finally { instance.dispose(); }

		gpu.enable32bitDataTextures = true;
		let halfLife = 1000;
		let reset = false;
		const add = await create(native('feedback'), ['output'], {
			input: { kind: 'uniform', value: [2, -4, 120000, 0.5] }, halfLife: { kind: 'value', get value() { return halfLife; } },
			reset: { kind: 'value', get value() { return reset; } },
		});
		try {
			const output = add.outputs.get('output');
			check(output.texture.format === 'rgba32float', '32-bit data history');
			const expected = 1 / Math.LN2;
			render(add, 1000);
			const oneStep = await read(output.texture);
			near(oneStep[0], expected, 'integrated add');
			near(oneStep[1], -2 * expected, 'signed data');
			near(oneStep[2], 60000 * expected, 'data above the float16 range', 0.01);
			add.resetRenderHistory();
			render(add, 1000);
			near((await read(output.texture))[0], 0, 'ignore elapsed time before a history reset');
			render(add, 500);
			render(add, 500);
			near((await read(output.texture))[0], oneStep[0], 'time-step independence');
			reset = true;
			render(add, 500);
			near((await read(output.texture))[0], 0, 'Reset parameter clears accumulation');
			reset = false;
			halfLife = 0;
			render(add, 500);
			near((await read(output.texture))[0], 0, 'zero half-life');
		} finally { add.dispose(); }
	});
}
