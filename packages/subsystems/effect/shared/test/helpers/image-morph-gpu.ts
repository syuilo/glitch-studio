import definition from '../../src/fx/imageMorph/_def_.ts';
import implementation from '../../src/fx/imageMorph/_impl_.ts';
import displacementImplementation from '../../src/fx/vectorDisplacement/_impl_.ts';
import commonCode from '../../src/fx/imageMorph/common.wgsl?raw';
import inverseCode from '../../src/fx/imageMorph/inverse.wgsl?raw';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput, ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { EffectOutputDataMap, RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Color = [number, number, number, number];
type Port = keyof typeof definition.outputDefs;
const ports = ['output', 'warpA', 'warpB', 'confidence'] as const;
const gray = (value: number, alpha = 1): Color => [value * alpha, value * alpha, value * alpha, alpha];

export async function run({ benchmark = false }: { benchmark?: boolean } = {}) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: '@group(0) @binding(0) var image: texture_2d<f32>; @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }' }), targets: [{ format: 'rgba32float' }] },
	});
	const defaults: Parameters = {
		inputA: constantShaderInput('color', [0, 0, 0, 0]), inputB: constantShaderInput('color', [0, 0, 0, 0]),
		progress: 0.5, warpStrength: 1, linkBlendToProgress: true, blend: 0.5, searchRange: 0.2,
		smoothness: 0.05, confidenceGuard: true, analysisResolution: 32, pyramidLevels: 3, iterations: 8,
	};
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	function check(condition: boolean, label: string) {
		if (!condition) throw new Error(label);
		checks.push(label);
	}
	function compare(actual: Float32Array, expected: Color[], label: string, tolerance = 0.001) {
		const components = expected.flat();
		if (actual.length !== components.length) throw new Error(`${label}: dimensions`);
		actual.forEach((value, index) => {
			if (!Number.isFinite(value) || Math.abs(value - components[index]) > tolerance) throw new Error(`${label}: pixel ${Math.floor(index / 4)} channel ${index % 4}: ${value} != ${components[index]}`);
		});
		checks.push(label);
	}
	function texture(width: number, height: number, pixels: Color[], sampling: Partial<ShaderInputSampling> = {}) {
		const image = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture: image }, new Float16Array(pixels.flat()), { bytesPerRow: width * 8 }, [width, height]);
		disposables.push(() => image.destroy());
		return textureShaderInput(image, { fitMode: 'stretch', wrapMode: 'transparent', filterMode: 'nearest', ...sampling });
	}
	function readback(image: GPUTexture) {
		const { width, height } = image;
		const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const group = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: image.createView() }] });
		disposables.push(() => { target.destroy(); buffer.destroy(); });
		return {
			encode: (encoder: GPUCommandEncoder) => {
				const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(reader); pass.setBindGroup(0, group); pass.draw(3); pass.end();
				encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			},
			pixels: async () => {
				await buffer.mapAsync(GPUMapMode.READ);
				const result = new Float32Array(width * height * 4);
				try {
					const mapped = new Float32Array(buffer.getMappedRange());
					for (let y = 0; y < height; y++) result.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
				} finally { buffer.unmap(); }
				return result;
			},
		};
	}
	const context = (encoder: GPUCommandEncoder) => ({
		commandEncoder: encoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
		createPassEncoder: (commandEncoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => commandEncoder.beginRenderPass(descriptor),
		createComputePassEncoder: (commandEncoder: GPUCommandEncoder) => commandEncoder.beginComputePass(),
		createPassEncoderFor: (commandEncoder: GPUCommandEncoder, view: GPUTextureView) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
	});
	async function validate() {
		const error = await device.popErrorScope();
		device.pushErrorScope('validation');
		if (error != null) throw new Error(error.message);
	}
	function createEffect(width: number, height: number, data32 = false, colorFormat: 'rgba16float' | 'rgba32float' = 'rgba16float', allocatedPorts: readonly Port[] = ports) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: colorFormat, enable32bitDataTextures: data32 };
		const textures = Object.fromEntries(ports.filter(port => port === 'output' || allocatedPorts.includes(port)).map(port => [port, implementation.outputTextureFactories[port]({ wgpu, resolution })])) as Record<Port, GPUTexture>;
		const outputDataMap = Object.fromEntries(Object.entries(textures).map(([port, image]) => [port, { texture: image, textureView: image.createView(), previousFrameTexture: null, previousFrameTextureView: null }])) as EffectOutputDataMap<typeof definition.outputDefs>;
		const effect = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: textures.output, reportStatus: () => {} });
		const readers = Object.fromEntries(Object.entries(textures).map(([port, image]) => [port, readback(image)])) as Record<Port, ReturnType<typeof readback>>;
		disposables.push(() => { effect.dispose(); for (const image of Object.values(textures)) image.destroy(); });
		return async (overrides: Partial<Parameters> = {}, usedPorts: readonly Port[] = ports, time = 0) => {
			const encoder = device.createCommandEncoder();
			effect.render({ ...context(encoder), time, params: { ...defaults, ...overrides }, outputDataMap, usedOutputPorts: new Set(usedPorts) });
			const readPorts = ports.filter(port => textures[port] != null && usedPorts.includes(port));
			for (const port of readPorts) readers[port].encode(encoder);
			device.queue.submit([encoder.finish()]);
			const pixels = Object.fromEntries(await Promise.all(readPorts.map(async port => [port, await readers[port].pixels()]))) as Record<Port, Float32Array>;
			await validate();
			return { pixels, textures };
		};
	}
	async function displace(input: ShaderInput, vector: GPUTexture, width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba16float' as const, enable32bitDataTextures: false };
		const params = { input, vector: textureShaderInput(vector, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' }), amount: 1, flipX: false, flipY: false, rotation: 0 };
		const output = displacementImplementation.outputTextureFactories.output({ wgpu, resolution });
		const effect = displacementImplementation.init({ wgpu, resolution, params, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const readerOutput = readback(output);
		disposables.push(() => { effect.dispose(); output.destroy(); });
		const encoder = device.createCommandEncoder();
		effect.render({ ...context(encoder), params, outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } } });
		readerOutput.encode(encoder);
		device.queue.submit([encoder.finish()]);
		const result = await readerOutput.pixels();
		await validate();
		return result;
	}
	function meanRegion(pixels: Float32Array, width: number, left: number, top: number, right: number, bottom: number) {
		const mean = [0, 0, 0, 0];
		for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) for (let channel = 0; channel < 4; channel++) mean[channel] += pixels[(y * width + x) * 4 + channel] / ((right - left) * (bottom - top));
		return mean;
	}
	async function inverseFixture(guard: boolean, confidenceValue: number) {
		const width = 32;
		const height = 16;
		const flowPixels = Array.from({ length: width * height }, (_, index): Color => {
			const x = (index % width + 0.5) / width - 0.5;
			const y = (0.5 - (Math.floor(index / width) + 0.5) / height) * 0.5;
			return [0.4 * x, 0.2 * y, (1 / 1.4 - 1) * x, (1 / 1.2 - 1) * y];
		});
		// フローの4成分は画像のRGBAではなく二つのvectorなのでpremultiplyしない。
		const flow = texture(width, height, flowPixels, { filterMode: 'linear', wrapMode: 'clamp' });
		const confidenceInput = texture(width, height, Array.from({ length: width * height }, () => [confidenceValue, confidenceValue, 0, 1] as Color), { filterMode: 'linear', wrapMode: 'clamp' });
		if (flow.kind !== 'texture' || confidenceInput.kind !== 'texture') throw new Error('Invalid inverse fixture textures');
		const values = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		values.set({ canvasExtent: [1, 0.5], analysisSize: [width, height], sourceSize: [width, height], flowSize: [width, height], progress: 0.5, warpStrength: 1, blend: 0.5, searchRange: 0.2, smoothness: 0, stepScale: 1, confidenceGuard: Number(guard) });
		const uniforms = device.createBuffer({ size: values.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(uniforms, 0, values.arrayBuffer);
		const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: { module: device.createShaderModule({ code: commonCode + '\n' + inverseCode }), entryPoint: 'inverse', targets: [{ format: 'rgba32float' }, { format: 'r32float' }] } });
		const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
			{ binding: 0, resource: { buffer: uniforms } },
			{ binding: 1, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }) },
			{ binding: 2, resource: flow.texture.createView() }, { binding: 3, resource: confidenceInput.texture.createView() },
		] });
		const warps = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
		const confidenceOutput = device.createTexture({ size: [width, height], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
		disposables.push(() => { uniforms.destroy(); warps.destroy(); confidenceOutput.destroy(); });
		const warpsReader = readback(warps);
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass({ colorAttachments: [warps, confidenceOutput].map(image => ({ view: image.createView(), loadOp: 'clear', storeOp: 'store' })) });
		pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
		warpsReader.encode(encoder);
		device.queue.submit([encoder.finish()]);
		const result = await warpsReader.pixels();
		await validate();
		return result;
	}
	try {
		const render = createEffect(8, 4);
		const first: Color = [0.75, 0.25, 0.125, 0.25];
		const second: Color = [0.125, 0.5, 1, 0.75];
		const firstPremultiplied: Color = [0.1875, 0.0625, 0.03125, 0.25];
		const secondPremultiplied: Color = [0.09375, 0.375, 0.75, 0.75];
		const base: Partial<Parameters> = { inputA: constantShaderInput('color', first), inputB: constantShaderInput('color', second) };
		// 【進行度の端点と変形0で元画像・通常の混合を正確に保つ】
		// 透明色の二重乗算や、端点でも解析画像の色を返してしまう処理を検出する。
		compare((await render({ ...base, progress: 0, warpStrength: 2 })).pixels.output, Array.from({ length: 32 }, () => firstPremultiplied), 'progress zero preserves input A');
		compare((await render({ ...base, progress: 1, warpStrength: 2 })).pixels.output, Array.from({ length: 32 }, () => secondPremultiplied), 'progress one preserves input B');
		const mixed = firstPremultiplied.map((value, index) => value * 0.75 + secondPremultiplied[index] * 0.25) as Color;
		compare((await render({ ...base, progress: 0.25, warpStrength: 0 })).pixels.output, Array.from({ length: 32 }, () => mixed), 'zero warp strength is a premultiplied crossfade');
		compare((await render({ ...base, progress: 0, linkBlendToProgress: false, blend: 1 })).pixels.output, Array.from({ length: 32 }, () => secondPremultiplied), 'manual blend is independent of progress');

		// 【テクスチャ入力の端点と入力接続のFit・透明境界を保つ】
		// 解析解像度が異なっても、色の出力には元の入力を使い、containの余白も接続設定に従う。
		const fittedPixels: Color[] = [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], [1, 1, 1, 1]];
		const fittedInput = texture(2, 2, fittedPixels, { fitMode: 'contain' });
		const fittedExpected = Array.from({ length: 4 }, (_, y) => Array.from({ length: 8 }, (_, x) => x < 2 || x >= 6 ? gray(0, 0) : fittedPixels[Math.floor(y / 2) * 2 + Math.floor((x - 2) / 2)])).flat();
		compare((await render({ ...base, inputA: fittedInput, progress: 0, analysisResolution: 16 })).pixels.output, fittedExpected, 'endpoint sampling preserves connection fit and transparent margins');

		const width = 64;
		const height = 32;
		function translatedImage(offsetX: number, offsetY: number) {
			return Array.from({ length: width * height }, (_, index): Color => {
				const x = index % width - offsetX;
				const y = Math.floor(index / width) - offsetY;
				if (x < 8 || x >= 28 || y < 8 || y >= 24) return gray(0, 0);
				const hash = ((x * 173 + y * 271) % 31) / 31;
				return [(0.25 + hash * 0.5) * 0.75, (0.3 + (x - 8) / 40) * 0.75, (0.2 + (y - 8) / 32) * 0.75, 0.75];
			});
		}
		const firstPixels = translatedImage(0, 0);
		const secondPixels = translatedImage(8, -4);
		const middlePixels = translatedImage(4, -2);
		const inputA = texture(width, height, firstPixels);
		const inputB = texture(width, height, secondPixels);
		const motionBase: Partial<Parameters> = { inputA, inputB };
		const motionRender = createEffect(width, height);

		// 【同じ入力と変形0では画像片の細部・RGBA・ゼロ変位を保持する】
		// 解析用画像を出力したり、不要な座標往復で静止画像の画素がずれたりする実装を検出する。
		const unchanged = await motionRender({ ...motionBase, inputB: inputA });
		compare(unchanged.pixels.output, firstPixels, 'identical inputs preserve full resolution detail and alpha');
		compare(unchanged.pixels.warpA, Array.from({ length: width * height }, () => [0, 0, 0, 1]), 'identical inputs emit zero inverse warp A');
		compare(unchanged.pixels.warpB, Array.from({ length: width * height }, () => [0, 0, 0, 1]), 'identical inputs emit zero inverse warp B');
		const crossfade = firstPixels.map((color, index) => color.map((value, channel) => (value + secondPixels[index][channel]) * 0.5) as Color);
		compare((await motionRender({ ...motionBase, warpStrength: 0 })).pixels.output, crossfade, 'zero warp strength keeps a textured crossfade');
		const noSearch = await motionRender({ ...motionBase, searchRange: 0 });
		compare(noSearch.pixels.output, crossfade, 'zero search range disables geometric matching');

		// 【既知の右・上への移動を中間位置へ運び、両方向の逆変位を共通単位で返す】
		// 通常のクロスフェードより正しい中間画像へ近づくことを、独立した移動済み画像で確認する。
		const middle = await motionRender(motionBase);
		const warpA = meanRegion(middle.pixels.warpA, width, 17, 10, 27, 17);
		const warpB = meanRegion(middle.pixels.warpB, width, 17, 10, 27, 17);
		check(Math.abs(warpA[0] - 4 / 64) < 0.015 && Math.abs(warpA[1] - 2 / 64) < 0.015, `inverse warp A follows the intermediate position: ${warpA.slice(0, 2)}`);
		check(Math.abs(warpB[0] + 4 / 64) < 0.015 && Math.abs(warpB[1] + 2 / 64) < 0.015, `inverse warp B follows the intermediate position: ${warpB.slice(0, 2)}`);
		const expectedComponents = middlePixels.flat();
		const middleError = middle.pixels.output.reduce((sum, value, index) => sum + Math.abs(value - expectedComponents[index]), 0);
		const crossfadeError = crossfade.flat().reduce((sum, value, index) => sum + Math.abs(value - expectedComponents[index]), 0);
		check(middleError < crossfadeError * 0.8, `matching improves a known intermediate image: ${middleError} < ${crossfadeError * 0.8}`);
		check(Array.from(middle.pixels.confidence).every((value, index) => index % 4 !== 0 || (value >= 0 && value <= 1)), 'confidence is finite and bounded');

		// 【公開WarpをVector Displacementで使うと、Image Morphの変形を再現できる】
		// 速度・正方向のフロー・正規化座標を誤って出力する不具合を、別エフェクトとの接続で検出する。
		const displacedA = await displace(inputA, middle.textures.warpA, width, height);
		const displacedB = await displace(inputB, middle.textures.warpB, width, height);
		const reconstructed = Array.from({ length: width * height }, (_, index) => Array.from({ length: 4 }, (_, channel) => (displacedA[index * 4 + channel] + displacedB[index * 4 + channel]) * 0.5) as Color);
		compare(middle.pixels.output, reconstructed, 'public inverse warps reconstruct the morph through Vector Displacement');

		// 【描画順・時刻・品質変更・入力種別の変更後も同じ結果へ戻る】
		// 前回のフローを暗黙の初期値にする処理や、階層・uniform容量の古い参照が残る処理を防ぐ。
		await motionRender({ ...motionBase, analysisResolution: 16, pyramidLevels: 1, iterations: 1 });
		await motionRender({ ...base, analysisResolution: 24, pyramidLevels: 4, iterations: 12 });
		const repeated = await motionRender(motionBase, ports, 100);
		compare(repeated.pixels.output, Array.from({ length: width * height }, (_, index) => Array.from(middle.pixels.output.subarray(index * 4, index * 4 + 4)) as Color), 'matching is deterministic after quality input and time changes', 0);

		// 【出力解像度を倍にしても、変位の大きさを画素単位へ変えない】
		// 固定の解析領域と公開する長辺全体=1の単位により、プレビュー倍率の影響を受けない。
		const largeRender = createEffect(width * 2, height * 2);
		const larger = await largeRender(motionBase);
		const largerWarp = meanRegion(larger.pixels.warpA, width * 2, 34, 20, 54, 34);
		check(Math.abs(largerWarp[0] - warpA[0]) < 0.004 && Math.abs(largerWarp[1] - warpA[1]) < 0.004, 'public displacement is independent of output resolution');

		// 【遅延出力だけが接続されていても色出力や他ポートの割当へ依存しない】
		// 未確保のConfidenceやWarp Bへアクセスせず、必要な解析結果を単独で描画できることを確認する。
		const warpOnly = createEffect(width, height, false, 'rgba16float', ['warpA']);
		const onlyWarp = await warpOnly(motionBase, ['warpA']);
		compare(onlyWarp.pixels.warpA, Array.from({ length: width * height }, (_, index) => Array.from(middle.pixels.warpA.subarray(index * 4, index * 4 + 4)) as Color), 'lazy warp-only output matches the complete render', 0);
		const confidenceOnly = createEffect(8, 4, false, 'rgba16float', ['confidence']);
		const onlyConfidence = await confidenceOnly({ ...base, inputB: base.inputA }, ['confidence']);
		check(onlyConfidence.pixels.confidence.every((value, index) => index % 4 !== 0 || value > 0.99), 'lazy confidence-only output works with identical constants');

		// 【非一様な変位は中間位置の逆写像を解き、出力位置での単純なフロー乗算にしない】
		// Xを1.4倍・Yを1.2倍する既知の対応を直接与え、推定器とは独立に中間拡大の逆を検証する。
		const affineWarps = await inverseFixture(true, 1);
		let inverseError = 0;
		for (let y = 3; y < 13; y++) {
			for (let x = 6; x < 26; x++) {
				const pointX = (x + 0.5) / 32 - 0.5;
				const pointY = (0.5 - (y + 0.5) / 16) * 0.5;
				const expected = [pointX * (1 - 1 / 1.2), pointY * (1 - 1 / 1.1), pointX * (1 - 1.4 / 1.2), pointY * (1 - 1.2 / 1.1)];
				for (let channel = 0; channel < 4; channel++) inverseError = Math.max(inverseError, Math.abs(affineWarps[(y * 32 + x) * 4 + channel] - expected[channel]));
			}
		}
		check(inverseError < 0.0003, `nonuniform affine correspondences use the inverse intermediate map: ${inverseError}`);

		// 【Confidence Guardは低信頼の変形を抑え、解除すれば元の変位を使う】
		// 推定器の誤差へ依存せず、同じ既知の場と信頼度0を与えて安全側と表現用の挙動を区別する。
		const guardedWarps = await inverseFixture(true, 0);
		check(guardedWarps.every(value => value === 0), 'confidence guard suppresses unreliable inverse warps');
		const unguardedWarps = await inverseFixture(false, 0);
		check(unguardedWarps.some(value => Math.abs(value) > 0.01), 'disabling confidence guard preserves expressive deformation');

		// 【32bitのデータ・色出力でもalphaの規約と出力形式を保つ】
		// float32-filterableを要求したdeviceで、入力・内部データ・出力の精度設定を明示的に切り替える。
		if (supports32bit) {
			for (const colorFormat of ['rgba16float', 'rgba32float'] as const) {
				const preciseRender = createEffect(8, 4, true, colorFormat);
				const precise = await preciseRender({ ...base, progress: 0.25, warpStrength: 0 });
				compare(precise.pixels.output, Array.from({ length: 32 }, () => mixed), `32bit data with ${colorFormat} color preserves premultiplied mixing`);
				check(precise.textures.warpA.format === 'rg32float' && precise.textures.confidence.format === 'r32float', `32bit data output formats with ${colorFormat} color`);
			}
			const preciseMotion = await createEffect(width, height, true)(motionBase);
			const preciseWarp = meanRegion(preciseMotion.pixels.warpA, width, 17, 10, 27, 17);
			check(Math.abs(preciseWarp[0] - 4 / 64) < 0.015 && Math.abs(preciseWarp[1] - 2 / 64) < 0.015, '32bit data estimates and inverts moving image correspondences');
		}

		// 【不正な解析解像度やGPU上限超過を精度の自動削減で隠さない】
		// 設定を黙って変えるとプレビューと書き出しの対応が変わるため、描画前に拒否する。
		for (const analysisResolution of [0, NaN, 1e9]) {
			let rejected = false;
			try { await render({ ...base, analysisResolution }); } catch (error) { rejected = error instanceof Error && error.message.startsWith('Image Morph:'); }
			check(rejected, `invalid analysis resolution ${analysisResolution} is rejected`);
		}
		let benchmarkResult: { resolution: string; analysisResolution: number; milliseconds: number[] } | null = null;
		if (benchmark) {
			const resolution = { width: 1920, height: 1080 };
			const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba16float' as const, enable32bitDataTextures: false };
			const params = { ...defaults, ...motionBase, analysisResolution: 128, pyramidLevels: 4, iterations: 8 };
			const output = implementation.outputTextureFactories.output({ wgpu, resolution });
			const effect = implementation.init({ wgpu, resolution, params, resources: {}, fallbackTexture: output, reportStatus: () => {} });
			disposables.push(() => { effect.dispose(); output.destroy(); });
			const milliseconds: number[] = [];
			for (let iteration = 0; iteration < 4; iteration++) {
				const start = performance.now();
				const encoder = device.createCommandEncoder();
				effect.render({ ...context(encoder), params, usedOutputPorts: new Set(['output']), outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } } });
				device.queue.submit([encoder.finish()]);
				await device.queue.onSubmittedWorkDone();
				if (iteration > 0) milliseconds.push(performance.now() - start);
			}
			await validate();
			benchmarkResult = { resolution: '1920x1080', analysisResolution: 128, milliseconds };
		}
		return { checks, benchmark: benchmarkResult };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
