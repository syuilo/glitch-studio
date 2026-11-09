import positionDefinition from '../../src/fx/position/_def_.ts';
import positionImplementation from '../../src/fx/position/_impl_.ts';
import vectorMathDefinition from '../../src/fx/vectorMath/_def_.ts';
import vectorMathImplementation from '../../src/fx/vectorMath/_impl_.ts';
import dotProductDefinition from '../../src/fx/vectorDotProduct/_def_.ts';
import dotProductImplementation from '../../src/fx/vectorDotProduct/_impl_.ts';
import noiseDefinition from '../../src/fx/noise/_def_.ts';
import noiseImplementation from '../../src/fx/noise/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { VectorMathOperation } from '../../src/fx/vectorMath/operations.ts';

const vector = (value: readonly [number, number]) => constantShaderInput('vector', value);
const scalar = (value: number) => constantShaderInput('scalar', value);

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});

	// 各エフェクト固有の計算を持たず、実装そのものを描画して読み戻すための最小限の足場。
	function createEffect(definition: any, implementation: any, width: number, height: number, precise: boolean) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise, intermediateTextureFormat: 'rgba16float' as const };
		const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]: [string, any]) => [name,
			parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value,
		]));
		const output: GPUTexture = implementation.outputTextureFactories.output({ wgpu, resolution });
		const components = definition.outputDefs.output.dataType.kind === 'vector' ? 2 : 1;
		assert(output.format === `${components === 2 ? 'rg' : 'r'}${precise ? 32 : 16}float`, `${definition.id} data format`);
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { instance.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return {
			input: (sampling: Partial<ShaderInputSampling> = {}) => textureShaderInput(output, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest', ...sampling }),
			render: async (overrides: Record<string, unknown> = {}, time = 0) => {
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (commandEncoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => commandEncoder.beginRenderPass(descriptor),
					createComputePassEncoder: (commandEncoder: GPUCommandEncoder) => commandEncoder.beginComputePass(),
					createPassEncoderFor: (commandEncoder: GPUCommandEncoder, view: GPUTextureView) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(reader);
				pass.setBindGroup(0, readGroup);
				pass.draw(3);
				pass.end();
				encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
				device.queue.submit([encoder.finish()]);
				await buffer.mapAsync(GPUMapMode.READ);
				const pixels = new Float32Array(width * height * components);
				try {
					const mapped = new Float32Array(buffer.getMappedRange());
					for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
						for (let component = 0; component < components; component++) pixels[(y * width + x) * components + component] = mapped[y * bytesPerRow / 4 + x * 4 + component];
					}
				} finally { buffer.unmap(); }
				const error = await device.popErrorScope();
				device.pushErrorScope('validation');
				if (error != null) throw new Error(error.message);
				assert(pixels.every(Number.isFinite), `${definition.id} finite output`);
				return pixels;
			},
		};
	}
	function field(width: number, height: number, precise: boolean, valueAt: (x: number, y: number) => number[]) {
		// alpha=0のデータテクスチャにし、ベクトル・スカラーを色として解釈した場合も検出する。
		const texture = device.createTexture({ size: [width, height], format: precise ? 'rgba32float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const values = Array.from({ length: width * height }, (_, index) => {
			const value = valueAt(index % width, Math.floor(index / width));
			return [value[0], value[1] ?? 0, 0, 0];
		}).flat();
		const data = precise ? new Float32Array(values) : new Float16Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 4 * data.BYTES_PER_ELEMENT }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
	}
	try {
		for (const precise of supports32bit ? [false, true] : [false]) {
			const label = precise ? '32bit' : '16bit';
			const near = (actual: number, expected: number, name: string, tolerance = precise ? 0.00001 : 0.001) => assert(Math.abs(actual - expected) <= tolerance, `${label} ${name}: ${actual} != ${expected}`);
			const compare = (actual: Float32Array, expected: ArrayLike<number>, name: string, tolerance?: number) => {
				assert(actual.length === expected.length, `${name} dimensions`);
				actual.forEach((value, index) => near(value, expected[index], `${name}/${index}`, tolerance));
			};

			// 【画素中心の位置は縦横比が異なっても長辺全体=1・+Yが上になる】
			// 正方形だけでは分からない片軸の倍率漏れと、画素端・画素中心の取り違えを全画素で検証する。
			for (const [width, height] of [[1, 1], [16, 16], [32, 16], [16, 32], [64, 32]]) {
				const position = createEffect(positionDefinition, positionImplementation, width, height, precise);
				const pixels = await position.render();
				for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
					near(pixels[(y * width + x) * 2], (x + 0.5 - width / 2) / Math.max(width, height), 'position X');
					near(pixels[(y * width + x) * 2 + 1], (height / 2 - y - 0.5) / Math.max(width, height), 'position Y');
				}
				checks.push(`${label} Position ${width}x${height} pixel centers`);
			}

			// 【各演算は既知の値と一致し、演算の切り替え後も同じインスタンスを利用できる】
			// WGSLの演算番号・成分の混同・キャッシュの切替を、符号や1を超える値を含めて確認する。
			const math = createEffect(vectorMathDefinition, vectorMathImplementation, 1, 1, precise);
			const common = { inputA: vector([2, -3]), inputB: vector([-4, 5]), scale: scalar(-2), angle: scalar(0.25) };
			const cases: { operation: VectorMathOperation; expected: number[]; inputA?: readonly [number, number] }[] = [
				{ operation: 'add', expected: [-2, 2] }, { operation: 'subtract', expected: [6, -8] },
				{ operation: 'multiply', expected: [-8, -15] }, { operation: 'divide', expected: [-0.5, -0.6] },
				{ operation: 'scale', expected: [-4, 6] }, { operation: 'scaleAdd', expected: [-8, 11] },
				{ operation: 'rotate', inputA: [1, 0], expected: [0, -1] },
				{ operation: 'minimum', expected: [-4, -3] }, { operation: 'maximum', expected: [2, 5] },
				{ operation: 'absolute', expected: [2, 3] }, { operation: 'floor', inputA: [-1.25, 2.75], expected: [-2, 2] },
				{ operation: 'fract', inputA: [-1.25, 2.75], expected: [0.75, 0.75] },
				{ operation: 'sine', inputA: [-0.25, 1.25], expected: [-1, 1] }, { operation: 'cosine', inputA: [-0.5, 1], expected: [-1, 1] },
			];
			for (const { operation, expected, inputA } of cases) {
				compare(await math.render({ ...common, operation, inputA: inputA == null ? common.inputA : vector(inputA) }), expected, operation);
				checks.push(`${label} Vector Math ${operation}`);
			}
			compare(await math.render({ ...common, operation: 'add' }), [-2, 2], 'restored operation');
			compare(await math.render({ ...common, operation: 'divide', inputB: vector([0, 2]) }), [0, -1.5], 'zero denominator X');
			compare(await math.render({ ...common, operation: 'divide', inputB: vector([-2, 0]) }), [-1, 0], 'zero denominator Y');
			compare(await math.render({ operation: 'rotate', inputA: vector([1, 0]), angle: scalar(-0.25) }), [0, 1], 'negative quarter rotation');
			compare(await math.render({ operation: 'rotate', inputA: vector([1, 0]), angle: scalar(1.25) }), [0, -1], 'rotation periodicity');
			checks.push(`${label} operation cache division and rotation boundaries`);

			// 【ScaleとAngleも画素ごとに異なるスカラー場として使用できる】
			// uniformだけを検証して、ノード接続時の型・座標サンプリングの誤りを見落とさないようにする。
			const fields = createEffect(vectorMathDefinition, vectorMathImplementation, 4, 1, precise);
			const scale = field(4, 1, precise, x => [x - 2]);
			compare(await fields.render({ operation: 'scale', inputA: vector([1, -2]), scale }), [-2, 4, -1, 2, 0, 0, 1, -2], 'scale field');
			const angle = field(4, 1, precise, x => [x / 4]);
			compare(await fields.render({ operation: 'rotate', inputA: vector([1, 0]), angle }), [1, 0, 0, -1, -1, 0, 0, 1], 'angle field');
			const a = field(4, 1, precise, x => [x - 2, x + 1]);
			const b = field(4, 1, precise, x => [x + 1, -x - 2]);
			compare(await fields.render({ operation: 'add', inputA: a, inputB: b }), [-1, -1, 1, -1, 3, -1, 5, -1], 'vector fields');
			checks.push(`${label} vector scale and angle texture inputs`);

			// 【内積はスカラー型で負値も返し、同じベクトルの内積は長さの二乗になる】
			// ベクトル出力への詰め替えや、色としてのクランプ・alpha乗算を行わないことを確認する。
			const dot = createEffect(dotProductDefinition, dotProductImplementation, 1, 1, precise);
			compare(await dot.render(common), [-23], 'negative dot product');
			compare(await dot.render({ inputA: vector([3, 4]), inputB: vector([3, 4]) }), [25], 'squared length');
			compare(await dot.render({ inputA: vector([2, 3]), inputB: vector([-3, 2]) }), [0], 'orthogonal dot product');
			const dotFields = createEffect(dotProductDefinition, dotProductImplementation, 4, 1, precise);
			compare(await dotFields.render({ inputA: a, inputB: b }), [-4, -8, -12, -16], 'dot product fields');
			checks.push(`${label} scalar dot product constants and textures`);

			// 【Position→Vector Math→Noiseの座標接続が、同じ座標を直接渡した結果と一致する】
			// エフェクト単体の演算だけでは検出できない、共通座標・回転・値域・Noiseの座標単位の不整合を防ぐ。
			const position = createEffect(positionDefinition, positionImplementation, 32, 16, precise);
			await position.render();
			const rotation = createEffect(vectorMathDefinition, vectorMathImplementation, 32, 16, precise);
			await rotation.render({ operation: 'rotate', inputA: position.input(), angle: scalar(0.25) });
			const warp = createEffect(vectorMathDefinition, vectorMathImplementation, 32, 16, precise);
			const coordinates = await warp.render({ operation: 'scaleAdd', inputA: rotation.input(), scale: scalar(2), inputB: vector([0.25, -0.125]) });
			for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
				near(coordinates[(y * 32 + x) * 2], (16 - 2 * y - 1) / 32 + 0.25, 'warped coordinate X');
				near(coordinates[(y * 32 + x) * 2 + 1], -(2 * x + 1 - 32) / 32 - 0.125, 'warped coordinate Y');
			}
			checks.push(`${label} common coordinate transformation chain`);
			const noise = createEffect(noiseDefinition, noiseImplementation, 32, 16, precise);
			const sampleNoise = createEffect(noiseDefinition, noiseImplementation, 1, 1, precise);
			const settings = { octaves: 3, octaveRotation: 0, seed: 37, time: 0.25 };
			const screen = await noise.render(settings);
			compare(await noise.render({ ...settings, coordinateSource: 'input', coordinates: position.input() }), screen, 'Position matches Noise Screen', precise ? 0.0001 : 0.002);
			const warpedNoise = await noise.render({ ...settings, coordinateSource: 'input', coordinates: warp.input() });
			for (const [x, y] of [[0, 0], [7, 3], [16, 8], [31, 15]]) {
				const point: [number, number] = [(16 - 2 * y - 1) / 32 + 0.25, -(2 * x + 1 - 32) / 32 - 0.125];
				const reference = await sampleNoise.render({ ...settings, coordinateSource: 'input', coordinates: vector(point) });
				near(warpedNoise[y * 32 + x], reference[0], 'transformed Noise coordinates', precise ? 0.0001 : 0.002);
			}
			checks.push(`${label} Position and transformed coordinates feed Noise`);

			// 【同じ入力の結果は時刻・描画順序に依存しない】
			// 座標生成や演算へ不要なフレーム履歴が混ざると、シークや書き出し時に再現できなくなる。
			compare(await warp.render({ operation: 'scaleAdd', inputA: rotation.input(), scale: scalar(2), inputB: vector([0.25, -0.125]) }, 12345), coordinates, 'deterministic vector operations');
			compare(await position.render({}, 12345), await position.render({}, 0), 'deterministic coordinates');
			checks.push(`${label} deterministic seek order`);
		}
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
