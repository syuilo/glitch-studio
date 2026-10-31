import definition from '../../src/fx/sdfToMask/_def_.ts';
import implementation from '../../src/fx/sdfToMask/_impl_.ts';
import shapeDefinition from '../../src/fx/shapeSdf/_def_.ts';
import shapeImplementation from '../../src/fx/shapeSdf/_impl_.ts';
import maskToSdfImplementation from '../../src/fx/maskToSdf/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

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
	const defaults: Parameters = { sizeReference: 'height', input: constantShaderInput('scalar', 65504), mode: 'fill', offset: 0, strokeWidth: 0.01, strokeAlignment: 'center', feather: 0, antiAlias: true, invert: false };
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
		const group = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			effect.render(renderContext(encoder, output, { ...defaults, ...overrides }, time));
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
			assert(pixels.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'mask must stay finite and in range');
			return pixels;
		};
	}

	try {
		assert(definition.primaryInputParameter === 'input' && definition.resolutionInputParameters.join(',') === 'input' && definition.outputDefs.output.dataType.kind === 'scalar' && !definition.dependsOnRenderHistory, 'definition contract');
		checks.push('scalar input output and resolution contract');
		for (const precise of supports32bit ? [false, true] : [false]) {
			const label = precise ? '32bit' : '16bit';
			const near = (actual: number, expected: number, message: string) => {
				const tolerance = precise ? 3e-6 : 0.0006;
				assert(Math.abs(actual - expected) <= tolerance, `${label} ${message}: ${actual} != ${expected}`);
			};
			const sample = createEffect(1, 1, precise);
			const at = async (distance: number, parameters: Partial<Parameters> = {}) => (await sample({ ...parameters, input: constantShaderInput('scalar', distance) }))[0];

			// 【一様な距離・境界・Offset】微分0でも二値判定でき、空形状・境界ちょうどを
			// NaNや半透明の平面にしない。正負のOffsetによる膨張・収縮も確認する。
			near((await sample())[0], 0, 'default empty SDF');
			for (const antiAlias of [false, true]) {
				near(await at(-0.125, { antiAlias }), 1, 'negative inside');
				near(await at(0, { antiAlias }), 0, 'hard boundary is outside');
				near(await at(0.125, { antiAlias }), 0, 'positive outside');
			}
			near(await at(0.0625, { offset: 0.125 }), 1, 'positive offset expands');
			near(await at(-0.0625, { offset: -0.125 }), 0, 'negative offset contracts');
			near(await at(65504), 0, 'finite empty sentinel');
			near(await at(-65504), 1, 'large negative distance');
			checks.push(`${label}: fill offset and constant boundaries`);

			// 【輪郭の全幅・配置・端点】既知の距離を使い、片側への配置と
			// 幅ではなく半径として実装してしまう誤りを検出する。
			for (const [strokeAlignment, lower, upper] of [['inside', -0.125, 0], ['center', -0.0625, 0.0625], ['outside', 0, 0.125]] as const) {
				const parameters = { mode: 'stroke' as const, strokeAlignment, strokeWidth: 0.125, antiAlias: false };
				near(await at((lower + upper) / 2, parameters), 1, 'stroke interior');
				near(await at(lower, parameters), 0, 'stroke lower boundary');
				near(await at(upper, parameters), 0, 'stroke upper boundary');
				near(await at(lower - 0.03125, parameters), 0, 'stroke below range');
				near(await at(upper + 0.03125, parameters), 0, 'stroke above range');
				near(await at((lower + upper) / 2 + 0.25, { ...parameters, offset: 0.25 }), 1, 'offset moves the stroke');
			}
			checks.push(`${label}: stroke alignments full widths and endpoints`);

			// 【Featherの幅・中心と幅0の輪郭】Featherは境界の両側へ半分ずつ広げる。
			// 線より広いFeatherを指定しても中心を1へ正規化せず、幅0は必ず空にする。
			for (const [distance, expected] of [[-0.125, 1], [0, 0.5], [0.125, 0]]) near(await at(distance, { feather: 0.25 }), expected, 'feather endpoints and center');
			near(await at(0, { feather: -1 }), 0, 'negative feather is zero');
			near(await at(0, { mode: 'stroke', strokeWidth: 0.125, feather: 0.25 }), 0.6875, 'feathered thin stroke stays translucent');
			for (const antiAlias of [false, true]) for (const feather of [0, 0.25]) for (const strokeWidth of [0, -0.125]) {
				near(await at(0, { mode: 'stroke', antiAlias, feather, strokeWidth }), 0, 'nonpositive stroke width');
			}
			checks.push(`${label}: centered feather and zero width strokes`);

			// 【出力画素に応じたAAと細線】直線SDFの既知の微分幅で、半画素補間を確認する。
			// Featherとの最大値、SDF値の倍率、サブピクセル線を濃くしすぎないことも検証する。
			const width = 64;
			const height = 32;
			const render = createEffect(width, height, precise);
			const rampValues = Array.from({ length: width * height }, (_, index) => (index % width + 0.5 - 32.25) / height);
			const ramp = inputTexture(width, height, rampValues);
			const original = await render({ input: ramp });
			near(original[16 * width + 32], 0.15625, 'pixel-adaptive AA');
			near((await render({ input: ramp, antiAlias: false }))[16 * width + 32], 0, 'disabled AA');
			const scaledRamp = inputTexture(width, height, rampValues.map(value => value * 2));
			assert((await render({ input: scaledRamp })).every((value, index) => Math.abs(value - original[index]) < 0.00001), 'AA must adapt to distance scale');
			assert((await render({ input: ramp, feather: 1 / 64 })).every((value, index) => value === original[index]), 'subpixel feather must not add to AA width');
			const soft = await render({ input: ramp, feather: 0.125 });
			near(soft[16 * width + 32], 0.40673828125, 'feather dominates AA');
			assert((await render({ input: ramp, feather: 0.125, antiAlias: false })).every((value, index) => value === soft[index]), 'large feather is independent of AA');
			const centeredRamp = inputTexture(width, height, rampValues.map(value => value - 0.25 / height));
			near((await render({ input: centeredRamp, mode: 'stroke', strokeWidth: 0.25 / height }))[16 * width + 32], 0.3671875, 'subpixel stroke coverage');
			assert((await render({ input: centeredRamp, mode: 'stroke', strokeWidth: 0 })).every(value => value === 0), 'AA must not leave a zero-width line');
			checks.push(`${label}: adaptive AA feather maximum and subpixel lines`);

			// 【拡大縮小・縦横比・描画順序】入力より大きい/小さい解像度でもAAを出力画素へ
			// 合わせ、異なるパラメータ・時刻で描画した後も元の出力を再現する。
			near((await createEffect(32, 32, precise)({ input: ramp }))[16 * 32 + 16], 0.04296875, 'minified AA');
			near((await createEffect(128, 32, precise)({ input: ramp }))[16 * 128 + 64], 0.5, 'magnified AA');
			const portrait = await createEffect(64, 96, precise)({ input: ramp });
			near(portrait[48 * width + 32], 0.15625, 'portrait AA');
			const inverse = await render({ input: ramp, invert: true });
			for (let index = 0; index < original.length; index++) near(inverse[index], 1 - original[index], 'inverted mask');
			assert((await render({ input: ramp }, 1000)).every((value, index) => value === original[index]), 'time and parameter history');
			assert((await render()).every(value => value === 0), 'input removal');
			checks.push(`${label}: resizing aspect ratios inversion and deterministic updates`);

			// 【透明余白を距離0と混ぜない】Containの余白が線やFeatherで埋まることを防ぐ。
			// nearest/linearの被覆率、Invertの順序、clampへの切替も同じ入力で確認する。
			const bounded = createEffect(16, 8, precise);
			const transparentZero = inputTexture(4, 4, Array(16).fill(0), { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' });
			const boundedParameters = { input: transparentZero, mode: 'stroke' as const, strokeWidth: 0.125, antiAlias: false };
			const nearest = await bounded(boundedParameters);
			for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) near(nearest[y * 16 + x], x >= 4 && x < 12 ? 1 : 0, 'transparent nearest bounds');
			const invertedBounds = await bounded({ ...boundedParameters, invert: true });
			for (let index = 0; index < nearest.length; index++) near(invertedBounds[index], 1 - nearest[index], 'invert after transparent coverage');
			if (transparentZero.kind !== 'texture') throw new Error('Expected texture fixture');
			const linearBounds = await bounded({ ...boundedParameters, input: { ...transparentZero, filterMode: 'linear' } });
			for (const [x, expected] of [[0, 0], [3, 0.25], [4, 0.75], [7, 1], [11, 0.75], [12, 0.25], [15, 0]]) near(linearBounds[4 * 16 + x], expected, 'transparent linear coverage');
			const positive = inputTexture(4, 4, Array(16).fill(0.125), { fitMode: 'contain', wrapMode: 'transparent' });
			assert((await bounded({ input: positive, feather: 0.25 })).every(value => value === 0), 'transparent SDF must not gain a feather halo');
			assert((await bounded({ ...boundedParameters, input: { ...transparentZero, wrapMode: 'clamp' } })).every(value => value === 1), 'clamp extends SDF');
			checks.push(`${label}: transparent nearest linear feather and inversion order`);

			// 【repeatとmirror-repeat】透明余白の専用処理が通常のwrapを上書きせず、
			// ノードの接続設定で指定した繰り返しの向きを保つことを確認する。
			for (const wrapMode of ['repeat', 'repeatMirrored'] as const) {
				const input = inputTexture(2, 1, [-1, 1], { fitMode: 'contain', wrapMode, filterMode: 'nearest' });
				const pixels = await createEffect(32, 8, precise)({ input, antiAlias: false });
				for (let x = 0; x < 32; x++) {
					const uv = (x + 0.5) / 16 - 0.5;
					const repeated = uv - Math.floor(uv);
					const mapped = wrapMode === 'repeat' || Math.abs(Math.floor(uv)) % 2 === 0 ? repeated : 1 - repeated;
					near(pixels[4 * 32 + x], mapped < 0.5 ? 1 : 0, 'repeat orientation');
				}
			}
			checks.push(`${label}: repeat and mirrored repeat sampling`);

			// 【既存のSDF生成エフェクトとの実接続】Shape SDFの円を塗り、Mask to SDFの
			// 二値マスクの符号を戻す。実際のテクスチャ形式・binding・単位の一致を確認する。
			const resolution = { width: 65, height: 65 };
			const wgpu = gpuContext(precise);
			const shapeParams: RuntimeEffectParameters<typeof shapeDefinition.paramDefs> = { sizeReference: 'height', shape: 'ellipse', position: [0, 0], size: [0.5, 0.5], rotation: 0, cornerRadius: 0 };
			const shapeOutput = shapeImplementation.outputTextureFactories.output({ wgpu, resolution });
			const shapeEffect = shapeImplementation.init({ wgpu, resolution, params: shapeParams, fallbackTexture: shapeOutput, reportStatus: () => {} });
			disposables.push(() => { shapeEffect.dispose(); shapeOutput.destroy(); });
			const shapeEncoder = device.createCommandEncoder();
			shapeEffect.render(renderContext(shapeEncoder, shapeOutput, shapeParams));
			device.queue.submit([shapeEncoder.finish()]);
			const chain = createEffect(65, 65, precise);
			const fromShape = await chain({ input: textureShaderInput(shapeOutput, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' }), antiAlias: false });
			const circleMask = Array.from({ length: 65 * 65 }, (_, index) => Math.hypot(index % 65 - 32, Math.floor(index / 65) - 32) / 65 < 0.25 ? 1 : 0);
			assert(fromShape.every((value, index) => value === circleMask[index]), 'Shape SDF connection');
			const maskParams = { input: inputTexture(65, 65, circleMask), threshold: 0.5, invert: false };
			const maskOutput = maskToSdfImplementation.outputTextureFactories.output({ wgpu, resolution });
			const maskEffect = maskToSdfImplementation.init({ wgpu, resolution, params: maskParams, fallbackTexture: maskOutput, reportStatus: () => {} });
			disposables.push(() => { maskEffect.dispose(); maskOutput.destroy(); });
			const maskEncoder = device.createCommandEncoder();
			maskEffect.render(renderContext(maskEncoder, maskOutput, maskParams));
			device.queue.submit([maskEncoder.finish()]);
			const fromMask = await chain({ input: textureShaderInput(maskOutput, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' }), antiAlias: false });
			assert(fromMask.every((value, index) => value === circleMask[index]), 'Mask to SDF connection');
			checks.push(`${label}: Shape SDF and Mask to SDF integration`);
		}
		// 【入力SDFの距離単位を維持し、マスクの拡張量を選択した基準で指定する】
		// 同じ0.15の距離に対し、高さの0.1では届かず、幅の0.1では届く横長の出力を使う。
		const referenceRenderer = createEffect(64, 32, false);
		for (const sizeReference of ['height', 'width', 'shortSide', 'longSide'] as const) {
			const result = await referenceRenderer({ sizeReference, input: constantShaderInput('scalar', 0.15), offset: 0.1, antiAlias: false });
			assert(result[0] === (sizeReference === 'height' || sizeReference === 'shortSide' ? 0 : 1), `${sizeReference}: offset length`);
		}
		checks.push('mask offset uses the selected size reference');
		return { checks };
	} finally {
		for (const dispose of disposables) dispose();
		device.destroy();
	}
}
