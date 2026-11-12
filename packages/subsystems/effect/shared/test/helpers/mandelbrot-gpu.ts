import definition from '../../src/fx/mandelbrot/_def_.ts';
import implementation from '../../src/fx/mandelbrot/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { referenceMandelbrot } from './mandelbrot-reference.ts';
import { verifyMandelbrotArithmetic } from './mandelbrot-arithmetic-gpu.ts';
import type { RuntimeEffectParameters, EffectOutputDataMap } from '../../src/effect-implementation.ts';
import type { EffectStatus } from '../../src/effect-status.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type OutputPort = keyof typeof definition.outputDefs;

export async function run(benchmark = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const vertex = device.createShaderModule({ code: vertexCode });
	const checks: string[] = [];
	const resources: (() => void)[] = [];
	function literal(value: unknown): unknown {
		if (value != null && typeof value === 'object' && !Array.isArray(value)
			&& Object.values(value).every(binding => binding != null && typeof binding === 'object' && 'inputSource' in binding)) {
			return Object.fromEntries(Object.entries(value).map(([key, binding]) => [key, literal(binding.value)]));
		}
		return structuredClone(value);
	}
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
		'canNode' in parameter && parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : literal(parameter.defaultValue.value),
	])) as Parameters;
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
	const near = (actual: number, expected: number, message: string, tolerance = 0.002) => {
		if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) throw new Error(`${message}: ${actual} != ${expected}`);
	};
	const allPorts: OutputPort[] = ['output', 'escapeIterations', 'smoothIterations', 'escapedMask', 'triangleInequalityAverage'];
	const numericPorts = allPorts.slice(1) as Exclude<OutputPort, 'output'>[];
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba32float' }],
	} });

	function createRenderer(width: number, height: number, ports = allPorts, float32Data = true) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: float32Data };
		const outputDataMap: Partial<EffectOutputDataMap<typeof definition.outputDefs>> = {};
		const rowBytes = Math.ceil(width * 16 / 256) * 256;
		const readbacks = new Map<OutputPort, { texture: GPUTexture; buffer: GPUBuffer; group: GPUBindGroup }>();
		for (const port of ports) {
			const texture = implementation.outputTextureFactories[port]({ wgpu, resolution });
			outputDataMap[port] = { texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null };
			const copy = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const buffer = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			const group = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] });
			readbacks.set(port, { texture: copy, buffer, group });
			resources.push(() => { texture.destroy(); copy.destroy(); buffer.destroy(); });
		}
		let status: EffectStatus = { type: 'ready' };
		let wake: (() => void) | null = null;
		const fallback = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: fallback,
			reportStatus: next => { status = next; wake?.(); wake = null; },
		});
		resources.push(() => { instance.dispose(); fallback.destroy(); });
		return {
			outputDataMap,
			async render(overrides: Partial<Parameters> = {}, time = 0) {
				const params = { ...defaults, ...overrides };
				device.pushErrorScope('validation');
				instance.prepare!(params);
				while (status.type === 'loading') await new Promise<void>(resolve => { wake = resolve; });
				if (status.type === 'error') throw new Error(status.message);
				const encoder = device.createCommandEncoder();
				instance.render({ params, commandEncoder: encoder, time, timeDelta: 1,
					outputDataMap: outputDataMap as EffectOutputDataMap<typeof definition.outputDefs>, usedOutputPorts: new Set(ports),
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
					createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
					createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				});
				for (const readback of readbacks.values()) {
					const pass = encoder.beginRenderPass({ colorAttachments: [{ view: readback.texture.createView(), loadOp: 'clear', storeOp: 'store' }] });
					pass.setPipeline(reader); pass.setBindGroup(0, readback.group); pass.draw(3); pass.end();
					encoder.copyTextureToBuffer({ texture: readback.texture }, { buffer: readback.buffer, bytesPerRow: rowBytes }, resolution);
				}
				device.queue.submit([encoder.finish()]);
				const values = new Map<OutputPort, Float32Array>();
				for (const [port, readback] of readbacks) {
					await readback.buffer.mapAsync(GPUMapMode.READ);
					values.set(port, new Float32Array(readback.buffer.getMappedRange().slice(0))); readback.buffer.unmap();
				}
				const error = await device.popErrorScope();
				if (error != null) throw new Error(error.message);
				return {
					params, values,
					pixel(port: OutputPort, x = (width - 1) / 2, y = (height - 1) / 2) { return Array.from(values.get(port)!.slice(y * rowBytes / 4 + x * 4, y * rowBytes / 4 + x * 4 + 4)); },
				};
			},
		};
	}

	async function compare(width: number, height: number, overrides: Partial<Parameters>, label: string, coordinateOffset: [number, number] = [0, 0]) {
		const renderer = createRenderer(width, height);
		const pixels = await renderer.render({ ...overrides, coordinateOffset: constantShaderInput('vector', coordinateOffset) });
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const longSide = Math.max(width, height);
				const expected = referenceMandelbrot(pixels.params, [(x + 0.5 - width / 2) / longSide, (height / 2 - y - 0.5) / longSide], coordinateOffset);
				for (const port of numericPorts) near(pixels.pixel(port, x, y)[0], expected[port], `${label} ${port} (${x}, ${y})`);
			}
		}
		assert(true, label);
		return { renderer, pixels };
	}

	try {
		checks.push(await verifyMandelbrotArithmetic(device));
		// 【通常描画と深ズームを同じ直接反復の参照解で比較する】
		// 解像度・回転・ベクトル入力を変えて、公開座標と複素平面への換算を保持する。
		for (const [width, height] of [[7, 3], [3, 7]]) {
			await compare(width, height, { view: { center: [0, 0], zoom: 1, rotation: 0 } }, `direct ${width}x${height}`);
			await compare(width, height, { referenceCenter: { real: '-2', imaginary: '0' }, view: { center: [0, 0], zoom: 1e12, rotation: 0.125 } }, `rotated perturbation ${width}x${height}`, [0.03, -0.02]);
		}
		// 【f32・f64の中心加算では消える画素差を、指数分離した摂動で区別する】
		// -2近傍の実軸は左が発散、右が未発散となるため、画像全体が同じ値に潰れる退行を検出できる。
		for (const zoom of [1e6, 1e12, 1e30, 1e100, 1e280, 1e300]) {
			const { pixels } = await compare(9, 1, { referenceCenter: { real: '-2', imaginary: '0' }, view: { center: [0, 0], zoom, rotation: 0 }, maximumIterations: 2048 }, `deep zoom ${zoom}`);
			assert(pixels.pixel('escapedMask', 0, 0)[0] === 1 && pixels.pixel('escapedMask', 8, 0)[0] === 0, `distinct pixels at ${zoom}`);
		}
		// 【R=2を僅かに超える値を、通常数へ戻した軌道の比較で失わない】
		for (const zoom of [1e12, 1e100, 1e300]) {
			await compare(5, 1, { referenceCenter: { real: '-2', imaginary: '0' }, view: { center: [0, 0], zoom, rotation: 0 }, bailoutRadius: 2 }, `precise bailout ${zoom}`);
		}
		await compare(1, 1, { referenceCenter: { real: '-2.' + '0'.repeat(79) + '1', imaginary: '0' }, view: { center: [0, 0], zoom: 1e100, rotation: 0 }, bailoutRadius: 2 }, 'decimal center beyond binary64');
		// 【基準軌道の末尾と周期点をまたいでも、画素の総反復数をリセットしない】
		await compare(9, 3, { referenceCenter: { real: '0.2501', imaginary: '0' }, view: { center: [0, 0], zoom: 64, rotation: 0 }, bailoutRadius: 2, maximumIterations: 1024 }, 'reference escapes before some pixels');
		await compare(7, 1, { referenceCenter: { real: '-1', imaginary: '0' }, view: { center: [0, 0], zoom: 1000, rotation: 0 } }, 'periodic reference with rebasing');
		await compare(1, 1, { referenceCenter: { real: '0.250001', imaginary: '0' }, view: { center: [0, 0], zoom: 1e12, rotation: 0 }, maximumIterations: 8192 }, 'escape iteration above the old 2048 limit');
		const valley = { referenceCenter: { real: '-0.743643887037151', imaginary: '0.13182590420533' }, view: { center: [0, 0] as [number, number], zoom: 1e10, rotation: 0 }, maximumIterations: 8192 };
		const { renderer, pixels } = await compare(5, 3, valley, 'non-real deep reference');
		// 【彩色方式と時計・シーク順を変更しても数値出力と同条件の画素を維持する】
		for (const coloringMethod of ['escapeIterations', 'smoothEscapeIterations', 'triangleInequalityAverage'] as const) {
			const colored = await renderer.render({ ...valley, coloringMethod, colorPhase: 0.3 }, 99);
			for (const port of numericPorts) assert(colored.values.get(port)!.every((value, index) => value === pixels.values.get(port)![index]), `${coloringMethod} preserves ${port}`);
		}
		await renderer.render({ view: { center: [0, 0], zoom: 1, rotation: 0 } });
		const repeated = await renderer.render(valley, 1);
		assert(allPorts.every(port => repeated.values.get(port)!.every((value, index) => value === pixels.values.get(port)![index])), 'seek independent pixels');
		// 【AAは4個の独立した軌道を評価し、未発散値を反復数の平均へ混ぜない】
		const single = createRenderer(1, 1);
		const aaParameters = { referenceCenter: { real: '-2', imaginary: '0' }, view: { center: [0, 0] as [number, number], zoom: 1e12, rotation: 0 }, antialiasing: true };
		const antialiased = await single.render(aaParameters);
		const samples = [-0.25, 0.25].flatMap(x => [-0.25, 0.25].map(y => referenceMandelbrot(antialiased.params, [x, y])));
		const escaped = samples.reduce((sum, sample) => sum + sample.escapedMask, 0);
		near(antialiased.pixel('escapedMask')[0], escaped / 4, 'AA mask');
		for (const port of ['escapeIterations', 'smoothIterations', 'triangleInequalityAverage'] as const) near(antialiased.pixel(port)[0], samples.reduce((sum, sample) => sum + sample[port], 0) / Math.max(1, escaped), `AA ${port}`);
		assert(true, 'antialiasing matches four independent orbits');
		const transparent = await single.render({ ...aaParameters, ramp: { interpolation: 'linear', colorSpace: 'srgb', stops: [
			{ id: 'a', position: 0, color: [1, 0, 0, 0.5] }, { id: 'b', position: 1, color: [1, 0, 0, 0.5] },
		] }, unescapedColor: constantShaderInput('color', [1, 0, 0, 0.5]) });
		near(transparent.pixel('output')[0], 0.5, 'premultiplied red'); near(transparent.pixel('output')[3], 0.5, 'premultiplied alpha');
		assert(true, 'transparent coloring survives AA');
		// 【反復値は32bitで保持し、画像なしの疎な出力も同じ軌道を使う】
		const sparse = createRenderer(1, 1, ['escapeIterations', 'smoothIterations'], false);
		assert(sparse.outputDataMap.escapeIterations!.texture.format === 'r32float' && sparse.outputDataMap.smoothIterations!.texture.format === 'r32float', 'iteration outputs retain 32-bit precision');
		const sparsePixels = await sparse.render({ referenceCenter: { real: '0.250001', imaginary: '0' }, view: { center: [0, 0], zoom: 1e12, rotation: 0 }, maximumIterations: 8192 });
		assert(sparsePixels.pixel('escapeIterations')[0] > 2048 && sparse.outputDataMap.output == null, 'sparse high-iteration output');
		let timings: { phase: string; milliseconds: number }[] | null = null;
		if (benchmark) {
			// 初回準備・コンパイルと、同じ軌道・pipelineを再利用する描画を分ける。
			// GPU完了と読み戻しを含む経過時間であり、純粋なGPU timestampではない。
			const measured = createRenderer(128, 72, ['output']);
			timings = [];
			for (const phase of ['cold', 'warm', 'warm']) {
				const started = performance.now();
				await measured.render({ ...valley, maximumIterations: 2048 });
				timings.push({ phase, milliseconds: performance.now() - started });
			}
		}
		return { checks, timings };
	} finally {
		for (const dispose of resources.reverse()) dispose();
		device.destroy();
	}
}
