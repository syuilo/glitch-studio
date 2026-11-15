import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import definition from '../../src/fx/sampleImage/_def_.ts';
import implementation from '../../src/fx/sampleImage/_impl_.ts';
import positionImplementation from '../../src/fx/position/_impl_.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type SampleImageParameters = RuntimeEffectParameters<typeof definition.paramDefs>;
const coordinates = (value: readonly [number, number]) => constantShaderInput('vector', value);

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
		constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value)])) as SampleImageParameters;
	const sampling: ShaderInputSampling = { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' };
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });

	function renderContext(output: GPUTexture, time = 0) {
		return {
			commandEncoder: device.createCommandEncoder(), time, timeDelta: time * 1000,
			pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
			outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
			createPassEncoderFor: (encoder: GPUCommandEncoder, view: GPUTextureView) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			createPassEncoder: (encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => encoder.beginRenderPass(descriptor),
			createComputePassEncoder: (encoder: GPUCommandEncoder, descriptor?: GPUComputePassDescriptor) => encoder.beginComputePass(descriptor),
		};
	}

	function createEffect(width: number, height: number, precise = false) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === 'rgba16float', 'Image output must remain rgba16float');
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		disposers.push(() => { instance.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<SampleImageParameters> = {}, time = 0): Promise<number[]> => {
			const context = renderContext(output, time);
			instance.render({ ...context, params: { ...defaults, ...overrides } });
			const pass = context.createPassEncoderFor(context.commandEncoder, target.createView());
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			context.commandEncoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([context.commandEncoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			try {
				const data = new Float32Array(buffer.getMappedRange());
				const pixels: number[] = [];
				for (let row = 0; row < height; row++) pixels.push(...data.slice(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4));
				return pixels;
			} finally { buffer.unmap(); }
		};
	}

	function texture(width: number, height: number, format: 'rgba16float' | 'rg16float' | 'rg32float', pixelAt: (x: number, y: number) => number[]) {
		const image = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const values = Array.from({ length: width * height }, (_, index) => pixelAt(index % width, Math.floor(index / width))).flat();
		const data = format === 'rg32float' ? new Float32Array(values) : new Float16Array(values);
		device.queue.writeTexture({ texture: image }, data, { bytesPerRow: data.byteLength / height }, [width, height]);
		disposers.push(() => image.destroy());
		return image;
	}

	function positionField(width: number, height: number, precise: boolean) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const output = positionImplementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = positionImplementation.init({ wgpu, resolution, params: {}, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const context = renderContext(output);
		instance.render({ ...context, params: {} });
		device.queue.submit([context.commandEncoder.finish()]);
		disposers.push(() => { instance.dispose(); output.destroy(); });
		return textureShaderInput(output, sampling);
	}

	function compare(label: string, actual: number[], expected: number[]) {
		assert(actual.length === expected.length, `${label}: missing output pixels`);
		actual.forEach((value, index) => assert(Number.isFinite(value) && Math.abs(value - expected[index]) <= 0.001,
			`${label}: channel ${index} = ${value}, expected ${expected[index]}`));
		checks.push(label);
	}
	const repeat = (pixel: number[], count: number) => Array.from({ length: count }, () => pixel).flat();
	const sourcePixel = (x: number, y: number) => [x, y, -0.5, 0.5];
	try {
		const render = createEffect(4, 2);
		const source = texture(4, 2, 'rgba16float', sourcePixel);
		const input = textureShaderInput(source, sampling);
		// 【既定の座標は中央を参照し、未指定の主入力は透明になる】
		// 座標を変位と取り違えて素通ししたり、原点を左上と解釈したりする誤りを検出する。
		compare('default input is transparent', await render(), repeat([0, 0, 0, 0], 8));
		compare('default coordinates sample the center', await render({ input: textureShaderInput(source, { ...sampling, filterMode: 'linear' }) }), repeat([1.5, 0.5, -0.5, 0.5], 8));

		// 【定数とテクスチャの全組み合わせで同じ座標・色を扱う】
		// uniformを省略するパイプラインや入力種別の切り替えでも、alphaを二重乗算しないことを確かめる。
		const constantColor = constantShaderInput('color', [4, -1, 2, 0.5]);
		for (const precise of supports32bit ? [false, true] : [false]) {
			const pointField = textureShaderInput(texture(4, 2, precise ? 'rg32float' : 'rg16float', () => [0.125, 0.125]), sampling);
			for (const coordinateInput of [coordinates([0.125, 0.125]), pointField]) {
				compare(`${precise ? 32 : 16}bit uniform color with ${coordinateInput.kind} coordinates`, await render({ input: constantColor, coordinates: coordinateInput }), repeat([2, -0.5, 1, 0.5], 8));
				compare(`${precise ? 32 : 16}bit texture color with ${coordinateInput.kind} coordinates`, await render({ input, coordinates: coordinateInput }), repeat(sourcePixel(2, 0), 8));
			}

			// 【Positionを接続した画像は正方形・横長・縦長で全画素が元画像と一致する】
			// 実際のPosition出力を読み、長辺の換算・Y方向・画素中心と16bit/32bit接続を一緒に検証する。
			for (const [width, height] of [[1, 1], [8, 8], [16, 8], [8, 16], [32, 16]]) {
				const pixels = Array.from({ length: width * height }, (_, index) => [index % width / width, -Math.floor(index / width) / height, 2, 0.5]).flat();
				const image = texture(width, height, 'rgba16float', (x, y) => [x / width, -y / height, 2, 0.5]);
				compare(`${precise ? 32 : 16}bit Position identity at ${width}x${height}`, await createEffect(width, height, precise)({ input: textureShaderInput(image, sampling), coordinates: positionField(width, height, precise) }), pixels);
			}
		}

		// 【座標場は各出力画素の参照先を直接指定する】
		// 一様な座標だけでは発見できない、変位の加算・座標場の再帰的な参照・Y反転を検出する。
		const reversed = textureShaderInput(texture(4, 2, 'rg16float', (x, y) => [(1.5 - x) / 4, (y - 0.5) / 4]), sampling);
		const reversedPixels = Array.from({ length: 8 }, (_, index) => sourcePixel(3 - index % 4, 1 - Math.floor(index / 4))).flat();
		compare('coordinate field reverses both axes', await render({ input, coordinates: reversed }), reversedPixels);

		// 【InputのFilterで色を補間し、透明画素との間でも乗算済みの色を維持する】
		// 座標場の補間と画像の補間を混同せず、HDR・負値・半透明の線形補間を確認する。
		const betweenPixels = coordinates([0.0625, 0.125]);
		compare('nearest image sampling', await render({ input, coordinates: betweenPixels }), repeat(sourcePixel(2, 0), 8));
		compare('linear image sampling', await render({ input: textureShaderInput(source, { ...sampling, filterMode: 'linear' }), coordinates: betweenPixels }), repeat([1.75, 0, -0.5, 0.5], 8));
		const transparentSource = texture(2, 1, 'rgba16float', x => x === 0 ? [0, 0, 0, 0] : [4, -1, 2, 0.5]);
		compare('premultiplied transparent interpolation', await render({ input: textureShaderInput(transparentSource, { ...sampling, filterMode: 'linear' }) }), repeat([2, -0.5, 1, 0.25], 8));

		// 【描画先の共通座標へInputのFitを適用する】
		// 素材の縦横比で座標単位を決めたり、Fitの前後を取り違えたりすると異なる画素を参照してしまう。
		const renderSquare = createEffect(2, 2);
		const squarePoint = coordinates([-0.375, 0.125]);
		compare('stretch uses output coordinate space', await renderSquare({ input, coordinates: squarePoint }), repeat(sourcePixel(0, 0), 4));
		compare('cover fits after coordinate conversion', await renderSquare({ input: textureShaderInput(source, { ...sampling, fitMode: 'cover' }), coordinates: squarePoint }), repeat(sourcePixel(1, 0), 4));
		compare('contain exposes transparent margins', await renderSquare({ input: textureShaderInput(source, { ...sampling, fitMode: 'contain', wrapMode: 'transparent' }), coordinates: coordinates([0.125, 0.375]) }), repeat([0, 0, 0, 0], 4));

		// 【画面外の絶対座標はInputのWrapに従う】
		// Coordinatesを画面内へclampすると、繰り返しや透明境界を座標場から制御できなくなる。
		for (const [wrapMode, pixel] of [
			['clamp', sourcePixel(3, 0)], ['repeat', sourcePixel(0, 0)], ['repeatMirrored', sourcePixel(3, 0)], ['transparent', [0, 0, 0, 0]],
		] as const) {
			compare(`image wrap ${wrapMode}`, await render({ input: textureShaderInput(source, { ...sampling, wrapMode }), coordinates: coordinates([0.625, 0.125]) }), repeat([...pixel], 8));
		}

		// 【CoordinatesのFilterは座標値を補間し、InputのFilterとは独立する】
		// 座標場の解像度を画像に揃えなくても、入力ポートの設定どおりに参照位置を補間できることを確認する。
		const coarseCoordinates = texture(2, 1, 'rg16float', x => [x === 0 ? -0.375 : 0.375, 0.125]);
		compare('nearest coordinate field', await render({ input, coordinates: textureShaderInput(coarseCoordinates, sampling) }), [0, 0, 3, 3, 0, 0, 3, 3].flatMap(x => sourcePixel(x, 0)));
		compare('linear coordinate field', await render({ input, coordinates: textureShaderInput(coarseCoordinates, { ...sampling, filterMode: 'linear' }) }), [0, 1, 2, 3, 0, 1, 2, 3].flatMap(x => sourcePixel(x, 0)));

		// 【Coordinatesの透明な余白はゼロ座標となり、Inputの中央を参照する】
		// vectorの範囲外値を画像の透明度として扱ったり、Fitでベクトル値そのものを拡縮したりしない。
		const fittedCoordinates = textureShaderInput(coarseCoordinates, { ...sampling, fitMode: 'contain', wrapMode: 'transparent' });
		const fittedPixels = Array.from({ length: 16 }, (_, index) => {
			const row = Math.floor(index / 4);
			return row === 0 || row === 3 ? sourcePixel(2, 1) : sourcePixel(index % 4 < 2 ? 0 : 3, 0);
		}).flat();
		compare('coordinate fit and transparent wrap preserve vector meaning', await createEffect(4, 4)({ input, coordinates: fittedCoordinates }), fittedPixels);

		// 【入力種別や時刻を変更して戻しても同じ結果になる】
		// パイプラインのキャッシュや不要な描画履歴により、シーク後の参照位置が変わらないことを確認する。
		compare('deterministic sampling after variant changes', await render({ input, coordinates: reversed }, 12345), reversedPixels);
		const error = await device.popErrorScope();
		assert(error == null, error?.message ?? 'WebGPU validation failed');
		return { checks, supports32bit };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		device.destroy();
	}
}
