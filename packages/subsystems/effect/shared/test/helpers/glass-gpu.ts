import definition from '../../src/fx/glass/_def_.ts';
import implementation from '../../src/fx/glass/_impl_.ts';
import shapeImplementation from '../../src/fx/shapeSdf/_impl_.ts';
import maskImplementation from '../../src/fx/maskToSdf/_impl_.ts';
import booleanImplementation from '../../src/fx/sdfBoolean/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput, ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

// GPU側の有理化した式とは別に、断面の傾き・Snellの法則を角度で直接評価する。
// 屈折カーブの参照値であり、シェーダーの同じ計算をそのまま写さないようにする。
function curvedRefractionStrength(depthRatio: number, curvature: number, ior: number) {
	if (depthRatio >= 1 || ior <= 1) return 0;
	if (depthRatio <= 0) return 1;
	const remaining = 1 - depthRatio;
	const slope = remaining ** (curvature - 1) * (1 - remaining ** curvature) ** (1 / curvature - 1);
	const angle = Math.atan(slope);
	const transmittedAngle = Math.asin(Math.sin(angle) / ior);
	return Math.tan(angle - transmittedAngle) / Math.sqrt(ior ** 2 - 1);
}

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
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const color = (value: number[]) => constantShaderInput('color', value);
	const defaults: Parameters = {
		input: color([0, 0, 0, 0]), sdf: scalar(65504), refraction: 1, thickness: 0.03, edgeSoftness: 0.0015,
		refractionModel: 'quadratic', curvature: 4, ior: 1.5,
		blur: 0, aberration: 0.5, innerZoom: 1, innerZoomCenter: [0, 0], lightAngle: 300 / 360,
		highlight: 0.05, highlightColor: [1, 1, 1, 1], highlightSoftness: 0.5,
		fresnel: 0.1, fresnelColor: [1, 1, 1, 1], fresnelSoftness: 0.1,
		tintColor: [1, 1, 1, 1], tintIntensity: 0, tintPreserveLuminosity: true, cutout: false,
	};
	const neutral: Partial<Parameters> = { refraction: 0, highlight: 0, fresnel: 0, aberration: 0, edgeSoftness: 0 };
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const gpuContext = (precise: boolean, format: IntermediateTextureFormat = 'rgba16float') => ({ device, defaultVertexShaderModule: vertex, intermediateTextureFormat: format, enable32bitDataTextures: precise });
	const sampling = (overrides: Partial<ShaderInputSampling> = {}): ShaderInputSampling => ({ fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear', ...overrides });

	function inputTexture(width: number, height: number, components: 1 | 4, values: number[], precise = false, settings: Partial<ShaderInputSampling> = {}) {
		const format = components === 4 ? 'rgba16float' : precise ? 'r32float' : 'r16float';
		const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		disposables.push(() => texture.destroy());
		const data = precise && components === 1 ? new Float32Array(values) : new Float16Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: width * components * data.BYTES_PER_ELEMENT }, [width, height]);
		return { texture, input: textureShaderInput(texture, sampling(settings)) };
	}

	function field(width: number, height: number, precise: boolean, value: (u: number, v: number) => number, settings: Partial<ShaderInputSampling> = {}) {
		return inputTexture(width, height, 1, Array.from({ length: width * height }, (_, index) => value((index % width + 0.5) / width, (Math.floor(index / width) + 0.5) / height)), precise, settings).input;
	}

	function gradientImage(width: number, height: number) {
		return inputTexture(width, height, 4, Array.from({ length: width * height }, (_, index) => [(index % width + 0.5) / width, (Math.floor(index / width) + 0.5) / height, (index % width + 0.5) / width, 1]).flat()).input;
	}

	function createEffect(width: number, height: number, precise: boolean, format: IntermediateTextureFormat) {
		const resolution = { width, height };
		const wgpu = gpuContext(precise, format);
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === format, 'color format must be independent of data precision');
		const effect = implementation.init({ wgpu, resolution, params: defaults, fallbackTexture: output, reportStatus: () => {} });
		const copyTarget = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			effect.render(renderContext(encoder, output, { ...defaults, ...overrides }, time));
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(6); pass.end();
			encoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height * 4);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'all output components must stay finite');
			return pixels;
		};
	}

	function shape(size: [number, number], precise: boolean) {
		const resolution = { width: 64, height: 64 };
		const wgpu = gpuContext(precise);
		const params = { shape: 'ellipse' as const, position: [0, 0] as const, size, rotation: 0, cornerRadius: 0 };
		const output = shapeImplementation.outputTextureFactories.output({ wgpu, resolution });
		const effect = shapeImplementation.init({ wgpu, resolution, params, fallbackTexture: output, reportStatus: () => {} });
		const encoder = device.createCommandEncoder();
		effect.render(renderContext(encoder, output, params));
		device.queue.submit([encoder.finish()]);
		disposables.push(() => { effect.dispose(); output.destroy(); });
		return textureShaderInput(output, sampling());
	}

	function subtract(a: ShaderInput, b: ShaderInput, precise: boolean) {
		const resolution = { width: 64, height: 64 };
		const wgpu = gpuContext(precise);
		const params = { inputA: a, inputB: b, operation: 'difference' as const, smoothing: 0 };
		const output = booleanImplementation.outputTextureFactories.output({ wgpu, resolution });
		const effect = booleanImplementation.init({ wgpu, resolution, params, fallbackTexture: output, reportStatus: () => {} });
		const encoder = device.createCommandEncoder();
		effect.render(renderContext(encoder, output, params));
		device.queue.submit([encoder.finish()]);
		disposables.push(() => { effect.dispose(); output.destroy(); });
		return textureShaderInput(output, sampling());
	}

	function maskDistance(precise: boolean) {
		const resolution = { width: 64, height: 64 };
		const wgpu = gpuContext(precise);
		const params = { input: field(64, 64, precise, (u, v) => Math.abs(u - 0.5) < 0.25 && Math.abs(v - 0.5) < 0.25 ? 1 : 0), threshold: 0.5, invert: false };
		const output = maskImplementation.outputTextureFactories.output({ wgpu, resolution });
		const effect = maskImplementation.init({ wgpu, resolution, params, fallbackTexture: output, reportStatus: () => {} });
		const encoder = device.createCommandEncoder();
		effect.render(renderContext(encoder, output, params));
		device.queue.submit([encoder.finish()]);
		disposables.push(() => { effect.dispose(); output.destroy(); });
		return textureShaderInput(output, sampling());
	}

	try {
		// 【画像を主入力・解像度基準とし、SDFとズーム支点を独立させる】
		// SDFを画像へ暗黙変換したり、支点をノードの位置と兼用したりしない契約を確認する。
		assert(definition.primaryInputParameter === 'input' && definition.resolutionInputParameter === 'input' && definition.primaryOutput === 'output', 'primary input and resolution');
		assert(definition.paramDefs.input.dataType.kind === 'color' && definition.paramDefs.sdf.dataType.kind === 'scalar' && definition.outputDefs.output.dataType.kind === 'color', 'port types');
		assert(definition.paramDefs.sdf.defaultValue.value === 65504 && !definition.dependsOnRenderHistory, 'empty shape and deterministic definition');
		assert(definition.paramDefs.innerZoomCenter.defaultValue.value.join(',') === '0,0', 'independent zoom center defaults');
		assert(definition.paramDefs.refractionModel.defaultValue.value === 'quadratic' && definition.paramDefs.refractionModel.dataType.options.join(',') === 'quadratic,curvedSurface', 'refraction models and unchanged default');
		assert(definition.paramDefs.curvature.defaultValue.value === 4 && definition.paramDefs.ior.defaultValue.value === 1.5, 'curved surface defaults');
		assert(Object.entries(definition.paramDefs).filter(([, param]) => 'canNode' in param && param.canNode).map(([name]) => name).join(',') === 'input,sdf', 'only image and SDF are node inputs');
		checks.push('color and scalar ports independent zoom center and resolution contract');

		for (const precise of supports32bit ? [false, true] : [false]) for (const format of ['rgba8unorm', 'rgba16float'] as const) {
			const label = `${precise ? '32bit' : '16bit'} SDF / ${format}`;
			const tolerance = format === 'rgba8unorm' ? 0.0041 : 0.001;
			const near = (actual: number, expected: number, message: string) => assert(Math.abs(actual - expected) <= tolerance, `${label} ${message}: ${actual} != ${expected}`);
			const pixel = (pixels: Float32Array, width: number, x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x + 1) * 4));
			const rgbaNear = (actual: number[], expected: number[], message: string) => actual.forEach((value, channel) => near(value, expected[channel], `${message} channel ${channel}`));
			const sample = createEffect(1, 1, precise, format);
			const opaque = color([0.25, 0.5, 0.75, 1]);
			const full = { ...neutral, sdf: scalar(-1), input: opaque };

			// 【空形状は通過し、Cutoutなら全成分を透明にする】
			// 初期状態や形状の削除で画像が黒くなったり、RGBだけが透明領域へ残ったりするのを防ぐ。
			rgbaNear(Array.from(await sample({ input: opaque })), [0.25, 0.5, 0.75, 1], 'default empty passes image');
			rgbaNear(Array.from(await sample({ input: opaque, cutout: true })), [0, 0, 0, 0], 'empty cutout');
			rgbaNear(Array.from(await sample(full)), [0.25, 0.5, 0.75, 1], 'inside neutral identity');
			rgbaNear(Array.from(await sample({ ...full, sdf: scalar(0) })), [0.25, 0.5, 0.75, 1], 'constant zero stays outside');
			rgbaNear(Array.from(await sample({ sdf: scalar(-0.001), blur: 0.1, tintIntensity: 1 })), [0, 0, 0, 0], 'transparent image remains transparent with lighting');
			checks.push(`${label}: empty shapes cutout and transparent color identity`);

			// 【着色は未乗算色で行い、一度だけalphaを掛け直す】
			// 半透明画像の二重乗算と、色パラメータのalpha無視を既知の数値で検出する。
			const translucent = color([0.25, 0.5, 0.75, 0.5]);
			rgbaNear(Array.from(await sample({ ...full, input: translucent, tintIntensity: 1, tintColor: [1, 0, 0, 0.5], tintPreserveLuminosity: false })), [0.3125, 0.125, 0.1875, 0.5], 'tint respects straight color and tint alpha');
			const tinted = await sample({ ...full, input: translucent, tintIntensity: 0.5, tintColor: [1, 0, 0, 1] });
			near(tinted[0] * 0.299 + tinted[1] * 0.587 + tinted[2] * 0.114, (0.25 * 0.299 + 0.5 * 0.587 + 0.75 * 0.114) * 0.5, 'tint preserves luminance');
			checks.push(`${label}: tint alpha and luminance preservation`);

			// 【ズームの支点を形状と独立させ、画面座標のY方向も確認する】
			// 色勾配の画像は参照UVをそのまま表すため、倍率と支点の取り違えを検出できる。
			const render = createEffect(64, 64, precise, format);
			const image = gradientImage(64, 64);
			const zoomBase = { ...neutral, input: image, sdf: scalar(-1), innerZoom: 2 };
			const centered = pixel(await render(zoomBase), 64, 32, 32);
			const shifted = pixel(await render({ ...zoomBase, innerZoomCenter: [0.5, -0.5] }), 64, 32, 32);
			near(centered[0], 0.50390625, 'zoom around screen center X');
			near(centered[1], 0.50390625, 'zoom around screen center Y');
			near(shifted[0], 0.62890625, 'independent center moves X');
			near(shifted[1], 0.62890625, 'negative screen Y moves down in image');
			const circle = shape([0.6, 0.6], precise);
			const firstShape = await render({ ...zoomBase, sdf: circle, cutout: true });
			const secondShape = await render({ ...zoomBase, sdf: circle, cutout: true, innerZoomCenter: [0.5, -0.5] });
			assert(firstShape.every((value, index) => index % 4 !== 3 || value === secondShape[index]), 'zoom center must not move shape coverage');
			checks.push(`${label}: zoom scale center coordinates and fixed silhouette`);

			// 【屈折の方向・量・深さと縦横比補正】
			// 勾配1の平面SDFと既知の色勾配を使い、ピクセル数や横幅に依存しない距離を確認する。
			const depth = 0.015625;
			const strength = 0.15 * (1 - depth / 0.125) ** 2;
			const plane = field(64, 64, precise, u => u - 0.5078125 - depth);
			const refractParams = { ...neutral, input: image, sdf: plane, refraction: 1, thickness: 0.125 };
			const refracted = pixel(await render(refractParams), 64, 32, 32);
			near(refracted[0], 0.5078125 - strength, 'horizontal refraction in height units');
			near(refracted[1], 0.5078125, 'horizontal refraction does not move Y');
			near(pixel(await render({ ...refractParams, thickness: 0 }), 64, 32, 32)[0], 0.5078125, 'zero thickness disables refraction');
			near(pixel(await render({ ...refractParams, thickness: depth }), 64, 32, 32)[0], 0.5078125, 'deep interior has no rim refraction');
			const vertical = field(64, 64, precise, (_u, v) => 0.5078125 - v - depth);
			near(pixel(await render({ ...refractParams, sdf: vertical }), 64, 32, 32)[1], 0.5078125 + strength, 'upward normal samples downward');
			for (const [width, height] of [[128, 64], [128, 128]]) {
				const wideRender = createEffect(width, height, precise, format);
				const centerU = (width / 2 + 0.5) / width;
				const widePlane = field(width, height, precise, u => (u - centerU) * width / height - depth);
				const result = await wideRender({ ...refractParams, input: gradientImage(width, height), sdf: widePlane });
				near(pixel(result, width, width / 2, height / 2)[0], centerU - strength * height / width, 'resolution and aspect invariant refraction');
			}
			const nearestPlane = field(64, 64, precise, u => u - 0.5078125 - depth, { filterMode: 'nearest' });
			near(pixel(await render({ ...refractParams, sdf: nearestPlane }), 64, 32, 32)[0], 0.5078125 - strength, 'nearest SDF retains gradient');
			checks.push(`${label}: gradient refraction depth resolution aspect and nearest sampling`);

			// 【現行方式は新しいパラメータを参照せず、既定値の描画を維持する】
			// 数値による屈折量の確認に加え、画面全体でCurvature・IORや方式の切替の影響が残らないことを確認する。
			const quadraticReference = await render(refractParams);
			const explicitQuadratic = await render({ ...refractParams, refractionModel: 'quadratic', curvature: 6, ior: 1 });
			assert(quadraticReference.every((value, index) => value === explicitQuadratic[index]), 'quadratic ignores curvature and IOR without changing any pixel');
			checks.push(`${label}: unchanged quadratic default and inactive curved controls`);

			// 【新方式は断面の傾きとSnellの法則による参照値に一致する】
			// 二次曲線の指数を変えるだけの実装や、IORを全体の強度へ掛けるだけの実装を検出する。
			const curvedParams = { ...refractParams, refractionModel: 'curvedSurface' as const };
			for (const curvature of [2, 4, 6]) for (const ior of [1.3, 1.5, 2]) for (const depthRatio of [0.125, 0.5, 0.875]) {
				const profilePlane = field(64, 64, precise, u => u - 0.5078125 - 0.125 * depthRatio);
				const values = await render({ ...curvedParams, sdf: profilePlane, curvature, ior });
				const expected = 0.5078125 - 0.15 * curvedRefractionStrength(depthRatio, curvature, ior);
				near(pixel(values, 64, 32, 32)[0], expected, `curved profile k=${curvature} IOR=${ior} depth=${depthRatio}`);
			}
			const round = pixel(await render({ ...curvedParams, curvature: 2 }), 64, 32, 32)[0];
			const flat = pixel(await render({ ...curvedParams, curvature: 6 }), 64, 32, 32)[0];
			assert(flat > round + 0.01, 'higher curvature concentrates refraction near the edge');
			const nearUnitIndex = pixel(await render({ ...curvedParams, ior: 1.01 }), 64, 32, 32)[0];
			const glassIndex = pixel(await render({ ...curvedParams, ior: 1.5 }), 64, 32, 32)[0];
			// 縁の最大値で正規化するため、IORと内側の強さは単調関係ではない。
			// 8bitでも識別できる十分に異なる2つのIORで、パラメータが作用することを確認する。
			assert(Math.abs(nearUnitIndex - glassIndex) > 0.01, 'IOR changes the depth profile');
			checks.push(`${label}: curved profiles against independent Snell reference`);

			// 【新方式の縁・平坦部・IOR=1と範囲外値を有限に保つ】
			// 垂直な縁の傾きは無限大となるが、変位自体は有限。IOR=1の正規化で0/0を作らない。
			const boundary = field(64, 64, precise, u => u - 0.5078125);
			for (const curvature of [2, 6]) for (const ior of [1.000001, 2]) {
				const values = await render({ ...curvedParams, sdf: boundary, curvature, ior, cutout: true });
				rgbaNear(pixel(values, 64, 32, 32), [(0.5078125 - 0.15) * 0.5, 0.5078125 * 0.5, (0.5078125 - 0.15) * 0.5, 0.5], 'curved rim has fixed maximum displacement');
			}
			for (const parameters of [{ ior: 1 }, { ior: -1 }, { thickness: 0 }, { thickness: -1 }, { thickness: depth }, { refraction: 0 }]) {
				near(pixel(await render({ ...curvedParams, ...parameters }), 64, 32, 32)[0], 0.5078125, 'zero or inactive curved refraction');
			}
			near(pixel(await render({ ...curvedParams, sdf: scalar(-depth) }), 64, 32, 32)[0], 0.5078125, 'constant SDF has no displacement direction');
			const bounded = await render({ ...curvedParams, curvature: 6, ior: 2 });
			const beyondBounds = await render({ ...curvedParams, curvature: 100, ior: 100 });
			assert(bounded.every((value, index) => value === beyondBounds[index]), 'curved parameters clamp to supported upper bounds');
			const lowerBound = await render({ ...curvedParams, curvature: 2 });
			const belowBound = await render({ ...curvedParams, curvature: -1 });
			assert(lowerBound.every((value, index) => value === belowBound[index]), 'curvature clamps to supported lower bound');
			await render({ ...curvedParams, thickness: 1e-9, ior: 1.000001, sdf: boundary });
			checks.push(`${label}: finite curved rim endpoints zero IOR and parameter bounds`);

			// 【新方式も距離の単位・縦横比・勾配の向きを保つ】
			// 断面の傾きで変位量を決めるため、入力勾配の長さは強度へ二重に掛けない。
			const curvedStrength = 0.15 * curvedRefractionStrength(0.125, 4, 1.5);
			const shallowGradient = field(64, 64, precise, u => (u - 0.5078125) * 0.5 - depth);
			near(pixel(await render({ ...curvedParams, sdf: shallowGradient }), 64, 32, 32)[0], 0.5078125 - curvedStrength, 'curved displacement uses unit gradient direction');
			near(pixel(await render({ ...curvedParams, sdf: vertical }), 64, 32, 32)[1], 0.5078125 + curvedStrength, 'curved vertical direction');
			for (const [width, height] of [[128, 64], [128, 128]]) {
				const sizedRender = createEffect(width, height, precise, format);
				const centerU = (width / 2 + 0.5) / width;
				const sizedPlane = field(width, height, precise, u => (u - centerU) * width / height - depth);
				near(pixel(await sizedRender({ ...curvedParams, input: gradientImage(width, height), sdf: sizedPlane }), width, width / 2, height / 2)[0], centerU - curvedStrength * height / width, 'curved resolution and aspect invariance');
			}
			const switchedBack = await render(refractParams, 12.5);
			assert(quadraticReference.every((value, index) => value === switchedBack[index]), 'switching back restores every quadratic pixel');
			checks.push(`${label}: curved gradient direction resolution aspect and model switching`);

			// 【色収差は屈折ベクトルに沿って赤青を反対方向へずらす】
			// RGBを単に同じ画像位置から取ったり、透明な緑の位置で赤青を失ったりしない。
			const chromatic = pixel(await render({ ...refractParams, aberration: 1 }), 64, 32, 32);
			near(chromatic[0], 0.5078125 - strength * 1.06, 'red shifted further inward');
			near(chromatic[2], 0.5078125 - strength * 0.94, 'blue shifted outward');
			const whiteDomain = inputTexture(1, 1, 4, [1, 1, 1, 1], false, { wrapMode: 'transparent', filterMode: 'nearest' }).input;
			const offsetPosition = -strength * 2;
			const zoomCenterX = 2 * (1.005 - offsetPosition) - 0.015625;
			const separated = pixel(await render({ ...refractParams, input: whiteDomain, aberration: 1, innerZoom: 2, innerZoomCenter: [zoomCenterX, 0] }), 64, 32, 32);
			rgbaNear(separated, [1, 0, 0, 1], 'red coverage survives transparent green and blue');
			checks.push(`${label}: RGB separation and independent alpha coverage`);

			// 【ぼかしは乗算済みRGBAのまま計算し、時間によって揺れない】
			// 半透明の小さな光点を広げ、黒い縁やalphaの二重乗算が出ないことを確認する。
			const impulseRender = createEffect(33, 33, precise, format);
			const impulse = inputTexture(33, 33, 4, Array.from({ length: 33 * 33 }, (_, index) => index === 16 * 33 + 16 ? [0.5, 0.5, 0.5, 0.5] : [0, 0, 0, 0]).flat()).input;
			const blurParams = { ...neutral, sdf: scalar(-1), input: impulse, blur: 0.08 };
			const blurred = await impulseRender(blurParams);
			const blurredCenter = pixel(blurred, 33, 16, 16);
			assert(blurredCenter[3] > 0 && blurredCenter[3] < 0.5, 'blur spreads an impulse');
			assert(pixel(blurred, 33, 17, 16)[3] > 0, 'blur reaches neighboring pixels');
			assert(blurred.every((value, index) => index % 4 === 3 || Math.abs(value - blurred[index - index % 4 + 3]) <= tolerance), 'white blur RGB matches alpha');
			const repeated = await impulseRender(blurParams, 123.5);
			assert(blurred.every((value, index) => value === repeated[index]), 'blur is independent of time and frame order');
			checks.push(`${label}: deterministic frosted blur and premultiplied alpha`);

			// 【境界AAとFeatherはRGBA全体へ適用する】
			// Cutout時にRGBだけが残らず、境界ちょうどが半分の被覆率になることを確認する。
			const edgeRender = createEffect(16, 4, precise, format);
			const edgePlane = field(16, 4, precise, u => u - 0.53125);
			const edge = await edgeRender({ ...neutral, input: color([1, 1, 1, 0.5]), sdf: edgePlane, cutout: true });
			rgbaNear(pixel(edge, 16, 8, 2), [0.25, 0.25, 0.25, 0.25], 'AA boundary coverage');
			rgbaNear(pixel(edge, 16, 3, 2), [0.5, 0.5, 0.5, 0.5], 'inside coverage');
			rgbaNear(pixel(edge, 16, 13, 2), [0, 0, 0, 0], 'outside coverage');
			rgbaNear(Array.from(await sample({ ...full, sdf: scalar(0.0625), edgeSoftness: 0.25, cutout: true })), [0.25, 0.5, 0.75, 1].map(value => value * 0.15625), 'known feather value');
			checks.push(`${label}: AA feather and cutout premultiplied coverage`);

			// 【透明SDFの余白にはガラスを生成しない】
			// 一様に内側のSDFでもContainの矩形で閉じ、空形状はその矩形にも変換しない。
			const contained = field(8, 4, precise, () => -1, { fitMode: 'contain', wrapMode: 'transparent' });
			const containedParams = { ...neutral, input: opaque, sdf: contained, tintIntensity: 1, tintColor: [1, 0, 0, 1] as const, tintPreserveLuminosity: false };
			const containedResult = await render(containedParams);
			rgbaNear(pixel(containedResult, 64, 32, 3), [0.25, 0.5, 0.75, 1], 'contain margin passes base');
			rgbaNear(pixel(containedResult, 64, 32, 32), [1, 0, 0, 1], 'contain inside is glass');
			const cutoutContained = await render({ ...containedParams, cutout: true });
			rgbaNear(pixel(cutoutContained, 64, 32, 3), [0, 0, 0, 0], 'contain cutout margin');
			const emptyField = field(8, 4, precise, () => 65504, { fitMode: 'contain', wrapMode: 'transparent' });
			const emptyResult = await render({ ...containedParams, sdf: emptyField });
			for (const [x, y] of [[0, 0], [32, 32], [63, 63]]) rgbaNear(pixel(emptyResult, 64, x, y), [0.25, 0.5, 0.75, 1], 'empty texture never becomes a rectangle');
			checks.push(`${label}: transparent SDF containment and empty texture`);

			// 【画像のwrapは屈折・ズーム後の各サンプル位置へ適用する】
			// 上流画像を事前に切り抜くことで、Repeatや透明余白の意味を変えてしまわない。
			const wrappedRender = createEffect(8, 1, precise, format);
			const expectedRed = { repeat: [0, 0, 1, 1, 0, 0, 1, 1], repeatMirrored: [1, 1, 1, 1, 0, 0, 0, 0], clamp: [1, 1, 1, 1, 0, 0, 0, 0], transparent: [0, 0, 1, 1, 0, 0, 0, 0] };
			for (const wrapMode of ['repeat', 'repeatMirrored', 'clamp', 'transparent'] as const) {
				const wrapped = inputTexture(2, 1, 4, [1, 0, 0, 1, 0, 1, 0, 1], false, { wrapMode, filterMode: 'nearest' }).input;
				const values = await wrappedRender({ ...neutral, sdf: scalar(-1), input: wrapped, innerZoom: 0.5 });
				for (let x = 0; x < 8; x++) near(pixel(values, 8, x, 0)[0], expectedRed[wrapMode][x], `image wrap ${wrapMode}`);
			}
			checks.push(`${label}: image repeat mirror clamp and transparent sampling`);

			// 【照明の方向と色alpha、縁の発光の深さ】
			// RGBだけが常に加算される実装や、光の向き・幅の無視を検出する。
			const lightPlane = field(64, 64, precise, u => u - 0.5078125 - 0.001);
			const lightParams = { ...neutral, input: color([0, 0, 0, 1]), sdf: lightPlane, highlight: 0.5, lightAngle: 0 };
			const facing = pixel(await render(lightParams), 64, 32, 32);
			const away = pixel(await render({ ...lightParams, lightAngle: 0.5 }), 64, 32, 32);
			assert(facing[0] > away[0] + 0.02, 'rim responds to light direction');
			rgbaNear(pixel(await render({ ...lightParams, highlightColor: [1, 1, 1, 0] }), 64, 32, 32), [0, 0, 0, 1], 'transparent highlight color');
			const glow = await sample({ ...full, input: color([0, 0, 0, 1]), sdf: scalar(-0.003), fresnel: 0.1, fresnelSoftness: 0.1 });
			rgbaNear(Array.from(glow), [0.025, 0.025, 0.025, 1], 'fresnel falloff');
			checks.push(`${label}: directional highlight color alpha and fresnel falloff`);

			// 【既存の3種のSDFからガラス形状を構成できる】
			// 型の整合だけでなく、Booleanの穴と画像由来の輪郭が実際の被覆率になることを確認する。
			const ring = subtract(shape([0.8, 0.8], precise), shape([0.2, 0.2], precise), precise);
			const ringResult = await render({ ...full, sdf: ring, cutout: true });
			near(pixel(ringResult, 64, 32, 32)[3], 0, 'boolean hole is transparent');
			near(pixel(ringResult, 64, 45, 32)[3], 1, 'boolean ring is glass');
			near(pixel(ringResult, 64, 0, 0)[3], 0, 'outside shape is transparent');
			const maskResult = await render({ ...full, sdf: maskDistance(precise), cutout: true });
			near(pixel(maskResult, 64, 32, 32)[3], 1, 'mask-derived SDF interior');
			near(pixel(maskResult, 64, 0, 0)[3], 0, 'mask-derived SDF exterior');
			checks.push(`${label}: Shape SDF Mask to SDF and SDF Boolean connections`);

			// 【新方式でも合成SDFの穴・透明余白・独立したズーム支点を保つ】
			// 屈折モデルの変更が形状のマスク処理や画像の乗算済みRGBAを変えてしまわないことを確認する。
			const curvedRing = await render({ ...neutral, refractionModel: 'curvedSurface', input: image, sdf: ring, refraction: 1, blur: 0.01, aberration: 1, innerZoom: 2, innerZoomCenter: [0.5, -0.5], cutout: true });
			assert(curvedRing.every((value, index) => index % 4 !== 3 || value === ringResult[index]), 'curved mode preserves the boolean silhouette');
			const curvedMask = await render({ ...full, sdf: maskDistance(precise), refractionModel: 'curvedSurface', cutout: true });
			assert(curvedMask.every((value, index) => value === maskResult[index]), 'curved mode supports mask-derived distances');
			const curvedMargin = await render({ ...containedParams, refractionModel: 'curvedSurface', cutout: true });
			rgbaNear(pixel(curvedMargin, 64, 32, 3), [0, 0, 0, 0], 'curved mode leaves SDF margin transparent');
			const curvedTransparent = await render({ ...curvedParams, input: color([0, 0, 0, 0]), blur: 0.01, aberration: 1 });
			assert(curvedTransparent.every(value => value === 0), 'curved refraction preserves a transparent source');
			checks.push(`${label}: curved SDF connections zoom silhouette and transparent margins`);

			// 【入力変更・削除と範囲外パラメータで有限な結果を保つ】
			// texture/uniformの切り替えで古い接続が残らず、0以下の倍率や幅でNaNを作らない。
			await render({ ...refractParams, blur: 0.01, aberration: 1 });
			const removed = await render({ input: opaque });
			rgbaNear(pixel(removed, 64, 32, 32), [0.25, 0.5, 0.75, 1], 'removed SDF passes through');
			await render({ ...refractParams, thickness: -1, edgeSoftness: -1, blur: -1, refraction: -1, aberration: -1, innerZoom: 0, highlightSoftness: -1, fresnelSoftness: -1 });
			const again = await render(refractParams, 99);
			rgbaNear(pixel(again, 64, 32, 32), refracted, 'reconnection and time do not change output');
			checks.push(`${label}: parameter bounds input removal and deterministic reconnection`);
		}
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks };
	} finally {
		await device.queue.onSubmittedWorkDone();
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
