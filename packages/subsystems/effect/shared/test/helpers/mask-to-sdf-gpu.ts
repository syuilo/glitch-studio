import definition from '../../src/fx/maskToSdf/_def_.ts';
import implementation from '../../src/fx/maskToSdf/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

// JFAを再実装せず、閾値を横切る全ての隣接画素対と画面端から境界点を列挙する。
// GPUが各画素に一つだけ候補を残す誤差と、JFAの伝播による誤差を含めて比較する。
function referenceDistances(width: number, height: number, values: number[], threshold = 0.5, invert = false) {
	const points: [number, number][] = [];
	const inside = values.map(value => (value > threshold) !== invert);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const index = y * width + x;
		for (const [dx, dy] of [[1, 0], [0, 1]]) {
			if (x + dx >= width || y + dy >= height) continue;
			const neighbor = (y + dy) * width + x + dx;
			if (inside[index] === inside[neighbor]) continue;
			const fraction = (threshold - values[index]) / (values[neighbor] - values[index]);
			points.push([x + 0.5 + dx * fraction, y + 0.5 + dy * fraction]);
		}
		if (!inside[index]) continue;
		if (x === 0) points.push([0, y + 0.5]);
		if (x === width - 1) points.push([width, y + 0.5]);
		if (y === 0) points.push([x + 0.5, 0]);
		if (y === height - 1) points.push([x + 0.5, height]);
	}
	return values.map((_, index) => {
		if (points.length === 0) return 65504;
		const x = index % width + 0.5;
		const y = Math.floor(index / width) + 0.5;
		const distance = Math.min(...points.map(([px, py]) => Math.hypot(px - x, py - y))) / height;
		return inside[index] ? -distance : distance;
	});
}

export async function run(benchmarkEnabled = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) f32 { return textureLoad(image, vec2i(p.xy), 0).r; }` }), targets: [{ format: 'r32float' }] },
	});
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const defaults: Parameters = { input: constantShaderInput('scalar', 0), threshold: 0.5, invert: false };
	const benchmark: string[] = [];

	function inputTexture(width: number, height: number, values: number[], options: { fitMode?: 'stretch' | 'contain'; wrapMode?: 'clamp' | 'repeat' | 'transparent'; filterMode?: 'nearest' | 'linear' } = {}) {
		const texture = device.createTexture({ size: [width, height], format: supports32bit ? 'r32float' : 'r16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		disposables.push(() => texture.destroy());
		const data = supports32bit ? new Float32Array(values) : new Float16Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: width * data.BYTES_PER_ELEMENT }, [width, height]);
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest', ...options });
	}

	function createEffect(width: number, height: number, precise: boolean) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures: precise };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === (precise ? 'r32float' : 'r16float'), 'data texture precision');
		const effect = implementation.init({ wgpu, resolution, params: defaults, fallbackTexture: output, reportStatus: () => {} });
		const copyTarget = device.createTexture({ size: resolution, format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
		const group = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		const dispose = () => { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); };
		disposables.push(dispose);
		const encode = (encoder: GPUCommandEncoder, input: ShaderInput, overrides: Partial<Parameters> = {}, time = 0) => {
			effect.render({ params: { ...defaults, ...overrides, input }, commandEncoder: encoder, time, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor), createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
		};
		const render = async (input: ShaderInput = defaults.input, overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			encode(encoder, input, overrides, time);
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, group); pass.draw(6); pass.end();
			encoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width), y * width);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			return pixels;
		};
		return Object.assign(render, {
			async measure(input: ShaderInput) {
				// 初回のpipeline生成を除き、CPUでのコマンド生成からGPU完了までを計測する。
				// 画素のCPU読み戻しは含めない。GPUだけのtimestampではないことを表示にも残す。
				const durations: number[] = [];
				for (let iteration = 0; iteration < 6; iteration++) {
					const start = performance.now();
					const encoder = device.createCommandEncoder();
					encode(encoder, input);
					device.queue.submit([encoder.finish()]);
					await device.queue.onSubmittedWorkDone();
					if (iteration > 0) durations.push(performance.now() - start);
				}
				const error = await device.popErrorScope();
				device.pushErrorScope('validation');
				if (error != null) throw new Error(error.message);
				return durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
			},
		});
	}

	try {
		assert(definition.primaryInputParameter === 'input' && definition.resolutionInputParameter === 'input' && definition.outputDefs.output.dataType.kind === 'scalar' && !definition.dependsOnRenderHistory, 'definition contract');
		checks.push('scalar input output and resolution contract');
		for (const precise of supports32bit ? [false, true] : [false]) {
			const label = precise ? '32bit' : '16bit';
			const near = (actual: number, expected: number, message: string, allowance = 0) => {
				const tolerance = allowance + (precise ? 2e-6 : 2e-6 + Math.abs(expected) * 0.001);
				assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label} ${message}: ${actual} != ${expected}`);
			};
			const width = 31;
			const height = 19;
			const render = createEffect(width, height, precise);

			// 【空形状・一様な内側・同値の閾値】定数入力の切替でもseedを毎回初期化し、
			// 画面端を背景とする矩形の正確な距離と、空形状の有限値を保つ。
			const empty = await render();
			assert(empty.every(value => value === 65504), 'empty mask');
			const solid = await render(constantShaderInput('scalar', 1));
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				near(solid[y * width + x], -Math.min(x + 0.5, width - x - 0.5, y + 0.5, height - y - 0.5) / height, 'solid frame distance');
			}
			assert((await render(constantShaderInput('scalar', 0.5))).every(value => value === 65504), 'threshold equality is outside');
			assert((await render(constantShaderInput('scalar', 0.5), { invert: true })).every((value, index) => value === solid[index]), 'inverted equality and bounded background');
			assert((await render(inputTexture(2, 1, [1, 1]))).every((value, index) => value === solid[index]), 'uniform and texture input equivalence');
			checks.push(`${label}: empty solid equal threshold and uniform inputs`);

			// 【画素間の補間と制限しない閾値】境界を画素間の1/4位置へ置き、
			// 画素中心の距離や固定の半画素補正で代用していないことを確認する。
			const boundary = 12.25;
			const ramp = inputTexture(width, height, Array.from({ length: width * height }, (_, index) => index % width + 0.5));
			for (const invert of [false, true]) {
				const pixels = await render(ramp, { threshold: boundary, invert });
				for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
					const px = x + 0.5;
					const inside = (px > boundary) !== invert;
					const expected = inside ? -Math.min(Math.abs(px - boundary), invert ? px : width - px, y + 0.5, height - y - 0.5) / height : Math.abs(px - boundary) / height;
					near(pixels[y * width + x], expected, 'subpixel straight boundary');
				}
			}
			const negativeRamp = inputTexture(width, height, Array.from({ length: width * height }, (_, index) => (index % width + 0.5 - boundary) / 8 - 3));
			const shifted = await render(negativeRamp, { threshold: -3 });
			const original = await render(ramp, { threshold: boundary });
			assert(shifted.every((value, index) => Math.abs(value - original[index]) <= 2e-6), 'threshold must not clamp to zero or one');
			checks.push(`${label}: fractional boundaries inversion and unrestricted threshold`);

			// 【閾値付近の小さい差と保存範囲】減算前に8bit/16bitへ丸めず、
			// f16の上限を越える差でも無限大のまま境界補間しない。
			if (supports32bit) {
				const delicate = inputTexture(width, height, Array.from({ length: width * height }, (_, index) => 0.5 + (index % width + 0.5 - boundary) / 32768));
				const delicatePixels = await render(delicate);
				near(delicatePixels[9 * width + 12], -0.25 / height, 'small threshold difference');
			}
			const extremeMagnitude = supports32bit ? 1e6 : 65504;
			const extreme = inputTexture(width, height, Array.from({ length: width * height }, (_, index) => index % width < 12 ? -extremeMagnitude : extremeMagnitude));
			assert((await render(extreme, { threshold: 0 })).every(Number.isFinite), 'large differences must stay finite');
			checks.push(`${label}: small threshold differences and finite saturation`);

			// 【穴・細線・斜め輪郭・不連続なマスク】小画像の全境界点を総当たりし、
			// 符号と距離を比較する。有限点への近似とJFAの誤差はこのfixtureで1画素以内とする。
			const fixtures: [string, (x: number, y: number) => number][] = [
				['hole', (x, y) => x >= 3 && x < 28 && y >= 2 && y < 17 && !(x >= 12 && x < 18 && y >= 6 && y < 13) ? 1 : 0],
				['one pixel lines', (x, y) => x === 7 || y === 8 ? 1 : 0],
				['diagonal', (x, y) => x + y > 23 ? 1 : 0],
				['soft contour', (x, y) => Math.max(0, Math.min(1, (8 - Math.hypot(x - 15, y - 9)) / 2 + 0.5))],
				['disconnected', (x, y) => ((x * 17 + y * 13 + x * y * 3) % 8 + 0.5) / 8],
			];
			for (const [name, paint] of fixtures) {
				const values = Array.from({ length: width * height }, (_, index) => paint(index % width, Math.floor(index / width)));
				const input = inputTexture(width, height, values);
				const pixels = await render(input);
				const expected = referenceDistances(width, height, values);
				for (let index = 0; index < pixels.length; index++) {
					assert((pixels[index] <= 0) === (expected[index] <= 0), `${name}: incorrect sign at ${index}`);
					near(pixels[index], expected[index], `${name}: exhaustive boundary oracle at ${index}`, 1 / height);
				}
				assert((await render(input, {}, 1000)).every((value, index) => value === pixels[index]), 'time and history independence');
			}
			assert((await render()).every(value => value === 65504), 'removing input must clear previous candidates');
			checks.push(`${label}: holes thin lines diagonal soft edges and exhaustive oracle`);

			// 【入力解像度・fit・filter・wrap】異なる解像度からサンプリングした後の
			// マスクへ距離を生成し、repeatによってJFAの空間を周回させない。
			const smallRender = createEffect(32, 16, precise);
			const smallInput = inputTexture(2, 1, [0, 1]);
			const repeatingInput = inputTexture(2, 1, [0, 1], { wrapMode: 'repeat' });
			const nearest = await smallRender(smallInput);
			assert((await smallRender(repeatingInput)).every((value, index) => value === nearest[index]), 'JFA must not wrap');
			near(nearest[8 * 32], 15.5 / 16, 'stretched input boundary');
			const linear = await smallRender(inputTexture(2, 1, [0, 1], { filterMode: 'linear' }), { threshold: 0.25 });
			near(linear[8 * 32 + 11], 0.5 / 16, 'linear filtered threshold contour');
			const contained = await smallRender(inputTexture(1, 1, [1], { fitMode: 'contain', wrapMode: 'transparent' }));
			near(contained[8 * 32], 7.5 / 16, 'contain transparent margin');
			checks.push(`${label}: input resolution fit filter and bounded wrap`);

			// 【縦横比と計算解像度】等方的な画素距離を高さで割り、
			// 同じ輪郭の同じ画素中心を3倍解像度でも同じ距離として扱う。
			for (const [w, h] of [[65, 33], [17, 33], [1, 1]]) {
				const pixels = await createEffect(w, h, precise)(constantShaderInput('scalar', 1));
				for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) near(pixels[y * w + x], -Math.min(x + 0.5, w - x - 0.5, y + 0.5, h - y - 0.5) / h, 'height-based distance');
			}
			const renderRamp = async (w: number, h: number) => createEffect(w, h, precise)(inputTexture(w, h, Array.from({ length: w * h }, (_, index) => (index % w + 0.5) / h)), { threshold: 0.625 });
			const low = await renderRamp(33, 21);
			const high = await renderRamp(99, 63);
			for (let y = 0; y < 21; y++) for (let x = 0; x < 33; x++) near(high[(y * 3 + 1) * 99 + x * 3 + 1], low[y * 33 + x], 'resolution-independent units', supports32bit ? 0.001 / 21 : 0.001);
			checks.push(`${label}: aspect ratios resolution and one pixel output`);

			// 【大きな画素座標の小数部】f16で連続整数を表せない位置に境界を置き、
			// 整数IDの伝播と局所オフセットにより1/4画素の境界を失わないことを検証する。
			const wide = createEffect(4096, 8, precise);
			const wideInput = inputTexture(4096, 8, Array.from({ length: 4096 * 8 }, (_, index) => index % 4096 >= 3002 ? 1 : 0));
			const widePixels = await wide(wideInput, { threshold: 0.25 });
			near(widePixels[4 * 4096 + 3001], 0.25 / 8, 'large coordinate subpixel distance');
			near(widePixels[4 * 4096 + 3002], -0.75 / 8, 'large coordinate inside distance');
			assert(widePixels[4 * 4096] > 1, 'distances above one must not clamp');
			checks.push(`${label}: exact large identifiers and subpixel offsets`);

			if (benchmarkEnabled) {
				const checker = inputTexture(64, 64, Array.from({ length: 64 * 64 }, (_, index) => (index % 64 + Math.floor(index / 64)) % 2));
				const milliseconds = await createEffect(3840, 2160, precise).measure(checker);
				benchmark.push(`${label} 3840x2160, 64x64 checker: ${milliseconds.toFixed(2)} ms/frame average (CPU encoding through GPU completion, no pixel readback, five warm samples)`);
			}
		}
		return { checks, benchmark };
	} finally {
		for (const dispose of disposables) dispose();
		device.destroy();
	}
}
