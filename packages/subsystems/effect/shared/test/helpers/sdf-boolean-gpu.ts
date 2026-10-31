import definition from '../../src/fx/sdfBoolean/_def_.ts';
import implementation from '../../src/fx/sdfBoolean/_impl_.ts';
import shapeDefinition from '../../src/fx/shapeSdf/_def_.ts';
import shapeImplementation from '../../src/fx/shapeSdf/_impl_.ts';
import maskImplementation from '../../src/fx/sdfToMask/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Operation = Parameters['operation'];

function renderContext<Parameters>(encoder: GPUCommandEncoder, output: GPUTexture, params: Parameters, time = 0) {
	return {
		params, commandEncoder: encoder, time, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
		outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
		createPassEncoder: (commandEncoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => commandEncoder.beginRenderPass(descriptor),
		createComputePassEncoder: (commandEncoder: GPUCommandEncoder) => commandEncoder.beginComputePass(),
		createPassEncoderFor: (commandEncoder: GPUCommandEncoder, view: GPUTextureView) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
	};
}

export async function run() {
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
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const defaults: Parameters = { inputA: scalar(65504), inputB: scalar(65504), operation: 'union', smoothing: 0 };
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const gpuContext = (precise: boolean) => ({ device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures: precise });

	function inputTexture(width: number, height: number, values: number[], sampling: Partial<ShaderInputSampling> = {}) {
		const texture = device.createTexture({ size: [width, height], format: supports32bit ? 'r32float' : 'r16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		disposables.push(() => texture.destroy());
		const data = supports32bit ? new Float32Array(values) : new Float16Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: width * data.BYTES_PER_ELEMENT }, [width, height]);
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear', ...sampling });
	}

	function createEffect(width: number, height: number, precise: boolean) {
		const resolution = { width, height };
		const wgpu = gpuContext(precise);
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === (precise ? 'r32float' : 'r16float'), 'output data precision');
		const effect = implementation.init({ wgpu, resolution, params: defaults, fallbackTexture: output, reportStatus: () => {} });
		const copyTarget = device.createTexture({ size: resolution, format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); });
		return Object.assign(async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			effect.render(renderContext(encoder, output, { ...defaults, ...overrides }, time));
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(6); pass.end();
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
			assert(pixels.every(Number.isFinite), 'distances must stay finite');
			return pixels;
		}, { texture: output });
	}

	try {
		assert(definition.primaryInputParameter === 'inputA' && definition.primaryOutput === 'output' && definition.outputDefs.output.dataType.kind === 'scalar' && !definition.dependsOnRenderHistory, 'definition contract');
		assert(definition.paramDefs.operation.dataType.options.join(',') === 'union,intersection,difference', 'operation scope');
		checks.push('scalar SDF input output and operation contract');

		assert(definition.resolutionInputParameters.join(',') === 'inputA,inputB', 'static resolution inputs');

		for (const precise of supports32bit ? [false, true] : [false]) {
			const label = precise ? '32bit' : '16bit';
			const near = (actual: number, expected: number, message: string) => {
				const tolerance = precise ? 3e-6 + Math.abs(expected) * 2e-6 : 2e-5 + Math.abs(expected) * 0.001;
				assert(Math.abs(actual - expected) <= tolerance, `${label} ${message}: ${actual} != ${expected}`);
			};
			const sample = createEffect(1, 1, precise);
			const at = async (a: number, b: number, operation: Operation, smoothing = 0) => (await sample({ inputA: scalar(a), inputB: scalar(b), operation, smoothing }))[0];

			// 【和集合・共通部分・差分の距離と方向】内外の組合せごとに既知の値を確認し、
			// 0〜1へのclampや、Differenceをa-bやB-Aとしてしまう誤りを検出する。
			const examples = [
				[-0.25, 0.5, -0.25, 0.5, -0.25],
				[0.25, -0.5, -0.5, 0.25, 0.5],
				[-0.25, -0.5, -0.5, -0.25, 0.5],
				[0.25, 0.5, 0.25, 0.5, 0.25],
				[-2, 3, -2, 3, -2],
				[0, 0, 0, 0, 0],
			];
			for (const [a, b, union, intersection, difference] of examples) {
				near(await at(a, b, 'union'), union, 'union');
				near(await at(a, b, 'intersection'), intersection, 'intersection');
				near(await at(a, b, 'difference'), difference, 'difference A minus B');
			}
			checks.push(`${label}: boolean distances and difference direction`);

			// 【滑らかな合成の係数と局所性】同じ値ならk/4変化すること、入力差がk以上なら
			// 通常演算に戻ることを確認する。負数・極小のSmoothingで0除算を起こさない。
			near(await at(0, 0, 'union', 0.125), -0.03125, 'smooth union equal values');
			near(await at(0, 0, 'intersection', 0.125), 0.03125, 'smooth intersection equal values');
			near(await at(0.25, -0.25, 'difference', 0.125), 0.28125, 'smooth difference negates B');
			near(await at(-0.03125, 0.03125, 'union', 0.125), -0.0390625, 'partial smoothing weight');
			near(await at(0.03125, 0.03125, 'difference', 0.125), 0.0390625, 'partial difference smoothing');
			for (const operation of ['union', 'intersection', 'difference'] as const) {
				const hard = await at(-0.25, 0.5, operation);
				near(await at(-0.25, 0.5, operation, 0.125), hard, 'outside smoothing influence');
				near(await at(-0.25, 0.5, operation, -1), hard, 'negative smoothing');
				near(await at(-0.25, 0.5, operation, 1e-30), hard, 'tiny smoothing');
			}
			near(await at(0.03125, -0.03125, 'union', 0.125), -0.0390625, 'smooth union is symmetric');
			checks.push(`${label}: polynomial smoothing coefficient support and zero limit`);

			// 【空形状の恒等則】65504を有限の遠い輪郭として合成せず、
			// Smoothingが大きくても空から形状を作らない。定数とテクスチャの両方を確認する。
			for (const smoothing of [0, 0.125, 1e6]) {
				near(await at(65504, -0.125, 'union', smoothing), -0.125, 'empty union A');
				near(await at(-0.125, 65504, 'union', smoothing), -0.125, 'empty union B');
				near(await at(65504, -0.125, 'intersection', smoothing), 65504, 'empty intersection A');
				near(await at(-0.125, 65504, 'intersection', smoothing), 65504, 'empty intersection B');
				near(await at(65504, -0.125, 'difference', smoothing), 65504, 'empty difference A');
				near(await at(-0.125, 65504, 'difference', smoothing), -0.125, 'empty difference B');
				near(await at(65504, 65504, 'union', smoothing), 65504, 'both inputs empty');
			}
			const emptyTexture = inputTexture(4, 4, Array(16).fill(65504), { fitMode: 'contain', wrapMode: 'transparent' });
			assert((await createEffect(32, 16, precise)({ inputA: emptyTexture, smoothing: 1e6 })).every(value => value === 65504), 'clipped empty texture');
			checks.push(`${label}: empty field identities with smoothing`);

			// 【2種類の入力場・パラメータ更新・再現性】両方のテクスチャを同じ出力座標で読み、
			// input A/Bのtexture/uniform切替・別時刻の描画後も元の出力を保つ。
			const width = 64;
			const height = 32;
			const render = createEffect(width, height, precise);
			const inputA = inputTexture(width * 2, height * 2, Array.from({ length: width * height * 4 }, (_, index) => (index % (width * 2) + 0.5 - width) / (height * 2)));
			const inputB = inputTexture(width, height, Array.from({ length: width * height }, (_, index) => (Math.floor(index / width) + 0.5 - height / 2) / height));
			const original = await render({ inputA, inputB });
			for (const operation of ['union', 'intersection', 'difference'] as const) {
				const pixels = await render({ inputA, inputB, operation });
				for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
					const a = (x + 0.5 - width / 2) / height;
					const b = (y + 0.5 - height / 2) / height;
					const expected = operation === 'union' ? Math.min(a, b) : operation === 'intersection' ? Math.max(a, b) : Math.max(a, -b);
					near(pixels[y * width + x], expected, 'two sampled distance fields');
				}
			}
			await render({ inputA: scalar(-1), inputB, smoothing: 0.25 });
			assert((await render({ inputA, inputB }, 1000)).every((value, index) => value === original[index]), 'deterministic updates');
			assert((await render()).every(value => value === 65504), 'input removal');
			checks.push(`${label}: two texture inputs resolution changes and deterministic updates`);

			// 【Transparentの矩形による切り抜き】領域外を距離0や65504へ置換するのでなく、
			// 切り抜き境界までの距離を返す。A/Bそれぞれに処理し、Clampも区別する。
			const bounded = createEffect(32, 16, precise);
			const clipped = inputTexture(4, 4, Array(16).fill(-2), { fitMode: 'contain', wrapMode: 'transparent' });
			const fromA = await bounded({ inputA: clipped });
			const fromB = await bounded({ inputB: clipped });
			const cutout = await bounded({ inputA: scalar(-2), inputB: clipped, operation: 'difference' });
			for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
				const px = x + 0.5;
				const expected = px < 8 ? (8 - px) / 16 : px > 24 ? (px - 24) / 16 : -Math.min(px - 8, 24 - px, y + 0.5, 16 - y - 0.5) / 16;
				near(fromA[y * 32 + x], expected, 'clipped A rectangle');
				near(fromB[y * 32 + x], expected, 'clipped B rectangle');
				near(cutout[y * 32 + x], -expected, 'difference with clipped B');
			}
			if (clipped.kind !== 'texture') throw new Error('Expected texture fixture');
			assert((await bounded({ inputA: { ...clipped, wrapMode: 'clamp' } })).every(value => value === -2), 'clamp must extend distances');
			const cover = await bounded({ inputA: { ...clipped, fitMode: 'cover' } });
			near(cover[8 * 32 + 16], -0.96875, 'cover clipping in height units');
			const positive = inputTexture(4, 4, Array(16).fill(0.125), { fitMode: 'contain', wrapMode: 'transparent' });
			assert((await bounded({ inputA: positive })).every(value => value >= 0.125), 'transparent must not create a zero contour');
			checks.push(`${label}: transparent clipping in both operands and cover clamp modes`);

			// 【通常の繰り返しと補間】専用のTransparent処理がrepeat/mirrorを上書きせず、
			// filterと異なる入力寸法も通常のサンプリング規約に合わせる。
			for (const wrapMode of ['repeat', 'repeatMirrored'] as const) {
				const input = inputTexture(2, 1, [-0.5, 0.5], { fitMode: 'contain', wrapMode, filterMode: 'nearest' });
				const pixels = await createEffect(32, 8, precise)({ inputA: input });
				for (let x = 0; x < 32; x++) {
					const uv = (x + 0.5) / 16 - 0.5;
					const repeated = uv - Math.floor(uv);
					const mapped = wrapMode === 'repeat' || Math.abs(Math.floor(uv)) % 2 === 0 ? repeated : 1 - repeated;
					near(pixels[4 * 32 + x], mapped < 0.5 ? -0.5 : 0.5, 'repeat orientation');
				}
			}
			const filtered = inputTexture(2, 1, [-0.5, 0.5]);
			const filteredPixels = await createEffect(32, 8, precise)({ inputA: filtered });
			near(filteredPixels[4 * 32 + 15], -0.03125, 'linear interpolation');
			near(filteredPixels[4 * 32 + 16], 0.03125, 'linear interpolation across zero');
			checks.push(`${label}: repeat mirrored repeat and linear filtering`);

			// 【精度設定の有限範囲】16bitの限界値付近でもSmoothingで無限大を生成せず、
			// 32bitでは16bitの範囲を越える距離を保持する。
			near(await at(-65504, -65504, 'union', 65504), precise ? -81880 : -65504, 'negative saturation');
			near(await at(65000, 65000, 'intersection', 65504), precise ? 81376 : 65504, 'positive saturation');
			near(await at(0, 0, 'union', 1e-30), -2.5e-31, 'tiny equal-distance correction');
			checks.push(`${label}: finite output saturation and precision`);

			// 【Shape SDFからSDF to Maskまでの接続】離れた円の隙間が滑らかなUnionで
			// つながることを確認し、合成した距離場をそのままマスクへ渡す。
			const resolution = { width: 65, height: 65 };
			const wgpu = gpuContext(precise);
			const shapeInputs = [];
			for (const center of [-0.5, 0.5]) {
				const params: RuntimeEffectParameters<typeof shapeDefinition.paramDefs> = { shape: 'ellipse', position: [center, 0], size: [0.4, 0.4], rotation: 0, cornerRadius: 0 };
				const output = shapeImplementation.outputTextureFactories.output({ wgpu, resolution });
				const effect = shapeImplementation.init({ wgpu, resolution, params, fallbackTexture: output, reportStatus: () => {} });
				disposables.push(() => { effect.dispose(); output.destroy(); });
				const encoder = device.createCommandEncoder();
				effect.render(renderContext(encoder, output, params));
				device.queue.submit([encoder.finish()]);
				shapeInputs.push(textureShaderInput(output, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' }));
			}
			const combineShapes = createEffect(65, 65, precise);
			const centerIndex = 32 * 65 + 32;
			const hard = await combineShapes({ inputA: shapeInputs[0], inputB: shapeInputs[1] });
			near(hard[centerIndex], 0.05, 'separate circle gap');
			const smooth = await combineShapes({ inputA: shapeInputs[0], inputB: shapeInputs[1], smoothing: 0.25 });
			near(smooth[centerIndex], -0.0125, 'smooth union bridge');
			const maskParams = { input: textureShaderInput(combineShapes.texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' }), mode: 'fill' as const, offset: 0, strokeWidth: 0.01, strokeAlignment: 'center' as const, feather: 0, antiAlias: false, invert: false };
			const maskOutput = maskImplementation.outputTextureFactories.output({ wgpu, resolution });
			const maskEffect = maskImplementation.init({ wgpu, resolution, params: maskParams, fallbackTexture: maskOutput, reportStatus: () => {} });
			disposables.push(() => { maskEffect.dispose(); maskOutput.destroy(); });
			const encoder = device.createCommandEncoder();
			maskEffect.render(renderContext(encoder, maskOutput, maskParams));
			device.queue.submit([encoder.finish()]);
			const masked = await combineShapes({ inputA: textureShaderInput(maskOutput, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' }) });
			near(masked[centerIndex], 1, 'combined SDF converts to mask');
			near(masked[0], 0, 'mask background');
			checks.push(`${label}: Shape SDF boolean smoothing and SDF to Mask integration`);
		}
		return { checks };
	} finally {
		for (const dispose of disposables) dispose();
		device.destroy();
	}
}
