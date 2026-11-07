import definition from '../../src/fx/fractalFlame/_def_.ts';
import implementation from '../../src/fx/fractalFlame/_impl_.ts';
import type { FlameTransform } from '../../src/fx/fractalFlame/flame-settings.ts';
import type { EffectOutputDataMap, RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';
import { prepareColorRamp, evaluatePreparedColorRamp } from '@gs/shared/color-ramp.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type OutputPort = keyof typeof definition.outputDefs;

function defaultValue(dataType: DataType, binding: any): any {
	if (dataType.kind === 'array') return binding.value.map((element: any) => defaultValue(dataType.elementType, element.binding));
	if (dataType.kind === 'struct') return Object.fromEntries(Object.entries(dataType.fields).map(([name, field]) => [name, defaultValue(field, binding.value[name])]));
	return structuredClone(binding.value);
}

function fixedTransform(overrides: Partial<Omit<FlameTransform, 'variations'>> & { variations?: Partial<FlameTransform['variations']> } = {}): FlameTransform {
	return { weight: 1, position: [0, 0], rotation: 0, scale: [0, 0], shear: 0, colorPosition: 0.5, ...overrides,
		variations: { linear: 1, sinusoidal: 0, spherical: 0, swirl: 0, horseshoe: 0, polar: 0, handkerchief: 0, heart: 0, ...overrides.variations },
	};
}

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const vertex = device.createShaderModule({ code: vertexCode });
	const resources: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.001) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ~= ${expected}`);
	const effectDefaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, defaultValue(parameter.dataType, parameter.defaultValue)])) as Parameters;
	const redRamp: ColorRamp = { interpolation: 'linear', colorSpace: 'srgb', stops: [{ id: 'red', position: 0, color: [1, 0, 0, 1] }] };
	const defaults: Parameters = { ...effectDefaults, transforms: [fixedTransform()], ramp: redRamp, orbitCount: 128, iterations: 64, burnIn: 32, densityResolution: '256', symmetry: 1, gamma: 1, exposure: 1 };
	const readLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [readLayout] }), vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }],
	} });
	function createRenderer(width: number, height: number, useFloat32 = true, ports: OutputPort[] = ['output', 'density']) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: useFloat32, intermediateTextureFormat: 'rgba16float' as const };
		const outputDataMap: Partial<EffectOutputDataMap<typeof definition.outputDefs>> = {};
		const readbacks = new Map<OutputPort, { buffer: GPUBuffer; texture: GPUTexture; group: GPUBindGroup }>();
		const rowBytes = Math.ceil(width * 16 / 256) * 256;
		for (const port of ports) {
			const texture = implementation.outputTextureFactories[port]({ wgpu, resolution });
			outputDataMap[port] = { texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null };
			const copy = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const buffer = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			readbacks.set(port, { texture: copy, buffer, group: device.createBindGroup({ layout: readLayout, entries: [{ binding: 0, resource: texture.createView() }] }) });
			resources.push(() => { texture.destroy(); copy.destroy(); buffer.destroy(); });
		}
		const fallback = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: fallback, reportStatus: () => {} });
		resources.push(() => { instance.dispose(); fallback.destroy(); });
		let computePasses = 0;
		return {
			get computePasses() { return computePasses; },
			outputDataMap,
			async render(overrides: Partial<Parameters> = {}, time = 0, timeDelta = 0) {
				device.pushErrorScope('validation');
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, ...overrides }, time, timeDelta, commandEncoder: encoder,
					usedOutputPorts: new Set(ports), outputDataMap: outputDataMap as EffectOutputDataMap<typeof definition.outputDefs>,
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					createComputePassEncoder: commandEncoder => { computePasses++; return commandEncoder.beginComputePass(); },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
					createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
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
					values,
					pixel(port: OutputPort, x = (width - 1) / 2, y = (height - 1) / 2) { return Array.from(values.get(port)!.slice(y * rowBytes / 4 + x * 4, y * rowBytes / 4 + x * 4 + 4)); },
					moments() {
						const density = values.get('density')!;
						let mass = 0; let firstX = 0; let firstY = 0; let leftMass = 0;
						for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
							const value = density[y * rowBytes / 4 + x * 4] / Math.max(width, height) ** 2;
							mass += value; firstX += value * (x + 0.5 - width / 2) / Math.max(width, height); firstY += value * (height / 2 - y - 0.5) / Math.max(width, height);
							if (x < width / 2) leftMass += value;
						}
						return { mass, x: firstX / mass, y: firstY / mass, leftFraction: leftMass / mass };
					},
				};
			},
		};
	}
	try {
		device.pushErrorScope('validation');
		const single = createRenderer(1, 1);
		const initializationError = await device.popErrorScope();
		if (initializationError != null) throw new Error(initializationError.message);
		// 【固定点の密度と対数圧縮、Paletteの乗算済み透明度】
		// 中央の固定点は4セルへ1/4ずつ分配され、再構成した中心の密度を解析的に求められる。
		const initial = await single.render();
		const density = 256 * 256 / 4;
		near(initial.pixel('density')[0], density, 'fixed-point probability density', 0.01);
		const logDensity = Math.log1p(density);
		const intensity = logDensity / (1 + logDensity);
		near(initial.pixel('output')[0], intensity, 'log-density red channel');
		near(initial.pixel('output')[3], intensity, 'log-density alpha');
		const half = await single.render({ ramp: { ...redRamp, stops: [{ id: 'red', position: 0, color: [1, 0, 0, 0.5] }] } });
		near(half.pixel('output')[0], intensity * 0.5, 'premultiplied half red');
		near(half.pixel('output')[3], intensity * 0.5, 'palette opacity preserved');
		// 【Computeからも既存のRampの全補間方式・色空間を同じ規則で使う】
		// 端点だけのPaletteでは見つからないGPU stageの変更や、色空間・alphaの不一致を検出する。
		for (const interpolation of ['constant', 'linear', 'smoothstep'] as const) for (const colorSpace of ['srgb', 'linearSrgb', 'oklab', 'oklch'] as const) {
			const ramp: ColorRamp = { interpolation, colorSpace, stops: [{ id: 'a', position: 0, color: [0.9, 0.1, 0.3, 0.5] }, { id: 'b', position: 1, color: [0.1, 0.7, 0.9, 0.5] }] };
			const pixels = await single.render({ ramp });
			const expected = evaluatePreparedColorRamp(prepareColorRamp(ramp), 0.5);
			assert(expected.every((value, channel) => Math.abs(pixels.pixel('output')[channel] - value * intensity) < 0.016), `${interpolation}/${colorSpace} compute palette matches CPU within fixed-point precision`);
		}
		// 【構造的な配色では各サンプルの色を平均し、平均した色位置から色を引かない】
		// 同じ固定点で0と1の色位置を等確率に選ぶと、色位置はほぼ一様になる。
		// 中央だけ緑のPaletteで、平均位置0.5を引いて全面が緑になる誤りを区別する。
		const splitRamp: ColorRamp = { interpolation: 'constant', colorSpace: 'srgb', stops: [
			{ id: 'red', position: 0, color: [1, 0, 0, 1] }, { id: 'green', position: 0.49, color: [0, 1, 0, 1] }, { id: 'blue', position: 0.51, color: [0, 0, 1, 1] },
		] };
		const mixed = await single.render({ transforms: [fixedTransform({ colorPosition: 0 }), fixedTransform({ colorPosition: 1 })], ramp: splitRamp, iterations: 128 });
		const mixedColor = mixed.pixel('output');
		assert(mixedColor[0] / mixedColor[3] > 0.4 && mixedColor[2] / mixedColor[3] > 0.4 && mixedColor[1] / mixedColor[3] < 0.05, 'averages sampled colors instead of palette coordinates');
		// 【単一ステップの8種類の非線形写像と、その加重和】
		// アフィン変換を一定の点へ潰してから各variationを適用し、結果の重心を独立した解析式と比べる。
		const square = createRenderer(256, 256);
		const x = 0.8; const y = 0.6; const radius = Math.hypot(x, y); const theta = Math.atan2(x, y);
		const expectedVariations = {
			linear: [x, y], sinusoidal: [Math.sin(x), Math.sin(y)], spherical: [x / radius ** 2, y / radius ** 2],
			swirl: [x * Math.sin(radius ** 2) - y * Math.cos(radius ** 2), x * Math.cos(radius ** 2) + y * Math.sin(radius ** 2)],
			horseshoe: [(x * x - y * y) / radius, 2 * x * y / radius], polar: [theta / Math.PI, radius - 1],
			handkerchief: [radius * Math.sin(theta + radius), radius * Math.cos(theta - radius)], heart: [radius * Math.sin(theta * radius), -radius * Math.cos(theta * radius)],
		};
		for (const [name, expected] of Object.entries(expectedVariations)) {
			const variations = { linear: 0, sinusoidal: 0, spherical: 0, swirl: 0, horseshoe: 0, polar: 0, handkerchief: 0, heart: 0, [name]: 1 };
			const pixels = await square.render({ transforms: [fixedTransform({ position: [x / 4, y / 4], variations })], orbitCount: 64, iterations: 2, burnIn: 0 });
			const moments = pixels.moments();
			near(moments.mass, 1, `${name} conserved probability mass`);
			near(moments.x, expected[0] / 4, `${name} X`); near(moments.y, expected[1] / 4, `${name} Y`);
		}
		const blended = await square.render({ transforms: [fixedTransform({ position: [x / 4, y / 4], variations: { linear: 0.25, swirl: 0.75 } })] });
		near(blended.moments().x, (0.25 * x + 0.75 * expectedVariations.swirl[0]) / 4, 'variation mixtures share the same affine input');
		// 【位置・回転・拡縮は共通単位で描画し、キャッシュ済みの軌道を変えない】
		// 非正方形の画面でも同じ固定点を同じ位置へ描き、表示操作で重いcomputeを再実行しない。
		for (const [width, height] of [[256, 256], [256, 128], [128, 256], [512, 256]]) {
			const renderer = createRenderer(width, height);
			const parameters = { transforms: [fixedTransform({ position: [0.125, 0.0625] })] };
			const first = await renderer.render(parameters);
			near(first.moments().x, 0.125, `${width}x${height} common X`); near(first.moments().y, 0.0625, `${width}x${height} common Y`);
			const changed = await renderer.render({ ...parameters, rotation: 0.25, position: [0.0625, 0.03125], exposure: 3, gamma: 2 });
			near(changed.moments().x, 0.125, `${width}x${height} rotated X`); near(changed.moments().y, -0.09375, `${width}x${height} rotated Y`);
			assert(renderer.computePasses === 1, `${width}x${height} display changes reuse histogram`);
		}
		// 【選択重み・固定Seed・対称コピーの正規化】
		// 左右の固定点へ1:3で移る系で選択確率を確かめ、コピー数を明るさへ混ぜない。
		const weighted = { transforms: [fixedTransform({ position: [-0.125, 0], weight: 1 }), fixedTransform({ position: [0.125, 0], weight: 3 })] };
		const weightedPixels = await square.render(weighted);
		near(weightedPixels.moments().leftFraction, 0.25, 'relative transform selection weights', 0.025);
		const repeat = await square.render(weighted, 100, 1000 / 30);
		assert(repeat.values.get('density')!.every((value, index) => value === weightedPixels.values.get('density')![index]), 'clock and FPS do not change density');
		const seeded = await square.render({ ...weighted, seed: 17 });
		assert(seeded.values.get('density')!.some((value, index) => value !== weightedPixels.values.get('density')![index]), 'seed changes the deterministic sampling sequence');
		const rebuilt = await square.render(weighted, 5, 1000 / 120);
		assert(rebuilt.values.get('density')!.every((value, index) => value === weightedPixels.values.get('density')![index]), 'regeneration reproduces integer histogram exactly');
		for (const [symmetry, mirror] of [[1, false], [4, false], [1, true]] as const) {
			const pixels = await square.render({ transforms: [fixedTransform({ position: [0.125, 0.0625] })], symmetry, mirror });
			near(pixels.moments().mass, 1, `symmetry ${symmetry}/${mirror} conserves normalized mass`);
			near(pixels.moments().x, symmetry > 1 || mirror ? 0 : 0.125, `symmetry ${symmetry}/${mirror} X centroid`);
			near(pixels.moments().y, symmetry > 1 ? 0 : 0.0625, `symmetry ${symmetry}/${mirror} Y centroid`);
		}
		// 【Paletteや露光変更が密度を変えず、空・無効・発散の変換が残像を残さない】
		const base = await single.render();
		const recolored = await single.render({ ramp: splitRamp, colorPhase: 0.3, exposure: 0 });
		near(recolored.pixel('density')[0], base.pixel('density')[0], 'density is independent of palette phase and exposure');
		assert(recolored.pixel('output').every(value => value === 0), 'zero exposure is transparent');
		for (const transforms of [[], [fixedTransform({ weight: 0 })], [fixedTransform({ position: [10, 10] })], [fixedTransform({ scale: [100000, 100000] })]]) {
			const empty = await single.render({ transforms });
			assert(empty.pixel('output').every(value => value === 0) && empty.pixel('density')[0] === 0, 'empty disabled clipped or divergent transforms clear output');
		}
		const resized = await single.render({ densityResolution: '512' });
		near(resized.pixel('density')[0], 512 * 512 / 4, 'histogram resize replaces cached resources', 0.1);
		// 【疎なDensity出力と半精度のピークを有限値で扱う】
		// 画像が未確保でもlocationを維持し、16bitの範囲を超える密度をInfinityへしない。
		const sparse = createRenderer(1, 1, false, ['density']);
		assert(sparse.outputDataMap.output == null, 'unused color output is not allocated');
		near((await sparse.render()).pixel('density')[0], density, 'sparse density-only half precision');
		near((await sparse.render({ densityResolution: '1024' })).pixel('density')[0], 65504, 'half precision peak is clamped to largest finite value');
		// 【初期設定が空や固定点に潰れず、面積を持つ色付きの模様になる】
		const flame = await square.render(effectDefaults);
		const colors = flame.values.get('output')!;
		assert(colors.every(Number.isFinite), 'default flame has finite colors');
		assert(colors.filter((value, index) => index % 4 === 3 && value > 0.01).length > 1000, 'default flame covers a visible area');
		assert(colors.some((value, index) => index % 4 === 0 && value > 0.05) && colors.some((value, index) => index % 4 === 2 && value > 0.05), 'default flame has structural colors');
		return { checks };
	} finally {
		for (const dispose of resources.reverse()) dispose();
		device.destroy();
	}
}
