import definition from '../../src/fx/geometricOptics2d/_def_.ts';
import implementation from '../../src/fx/geometricOptics2d/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Source = Parameters['sources'][number];
type OpticalObject = Parameters['objects'][number];

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const precise = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: precise ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const owned: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (value: number, expected: number, tolerance: number, message: string) => assert(Number.isFinite(value) && Math.abs(value - expected) <= tolerance, `${message}: ${value} != ${expected}`);
	const defaults = { ...Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.defaultValue.value])), objects: [], sources: [], exposure: 0, lineWidth: 0.008, pathBudget: 4096 } as Parameters;
	const source = (overrides: Partial<Source> = {}): Source => ({ type: 'singleRay', position: [-0.4, 0], direction: 0, width: 0.2, spread: 1, power: 0.005, spectrum: 'monochromatic', wavelength: 550, ...overrides });
	const object = (sdf: ShaderInput, overrides: Partial<OpticalObject> = {}): OpticalObject => ({ sdf, material: 'dielectric', ior: 1.5, dispersion: 0, reflectivity: 1, absorptionRed: 0, absorptionGreen: 0, absorptionBlue: 0, ...overrides });
	const readLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [readLayout] }), vertex: { module: vertex }, fragment: { module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn read(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba32float' }] } });
	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, device.createBindGroup({ layout: readLayout, entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const result = new Float32Array(width * height * 4);
			for (let y = 0; y < height; y++) result.set(padded.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			buffer.unmap(); return result;
		} finally { buffer.destroy(); target.destroy(); }
	}
	function effect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === 'rgba16float', 'image output format');
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		owned.push(() => { instance.dispose(); output.destroy(); });
		return {
			width, height,
			async render(overrides: Partial<Parameters> = {}, time = 0) {
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: 16,
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
					createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
					createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				device.queue.submit([encoder.finish()]);
				const error = await device.popErrorScope(); device.pushErrorScope('validation');
				if (error != null) throw new Error(error.message);
				const pixels = await read(output);
				assert(pixels.every(Number.isFinite), 'non-finite output');
				return pixels;
			},
		};
	}
	function field(width: number, height: number, evaluate: (x: number, y: number) => number, use32bit = false) {
		const texture = device.createTexture({ size: [width, height], format: use32bit ? 'r32float' : 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const values = Array.from({ length: width * height }, (_, index) => evaluate((index % width + 0.5 - width / 2) / Math.max(width, height), (height / 2 - Math.floor(index / width) - 0.5) / Math.max(width, height)));
		const data = use32bit ? new Float32Array(values) : new Float16Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: width * (use32bit ? 4 : 2) }, [width, height]);
		owned.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'linear', wrapMode: 'clamp' });
	}
	function alphaAt(pixels: Float32Array, width: number, height: number, x: number, y: number) {
		const long = Math.max(width, height);
		const column = Math.max(0, Math.min(width - 1, Math.floor(width / 2 + x * long)));
		const row = Math.max(0, Math.min(height - 1, Math.floor(height / 2 - y * long)));
		return pixels[(row * width + column) * 4 + 3];
	}
	function crossSection(pixels: Float32Array, width: number, height: number, x: number, minimumY = -1, maximumY = 1) {
		const long = Math.max(width, height);
		const column = Math.floor(width / 2 + x * long);
		let flux = 0;
		let firstMoment = 0;
		let secondMoment = 0;
		for (let row = 0; row < height; row++) {
			const y = (height / 2 - row - 0.5) / long;
			if (y < minimumY || y > maximumY) continue;
			const alpha = pixels[(row * width + column) * 4 + 3];
			const energy = -Math.log(Math.max(1e-6, 1 - alpha)) / long;
			flux += energy; firstMoment += y * energy; secondMoment += y * y * energy;
		}
		const center = firstMoment / Math.max(flux, 1e-20);
		return { flux, center, deviation: Math.sqrt(Math.max(0, secondMoment / Math.max(flux, 1e-20) - center * center)) };
	}
	try {
		const square = effect(192, 192);
		// 【空間と単一光線】入力がない場合と、中央より上に置いた光線のY方向を確認する。
		assert((await square.render()).every(value => value === 0), 'empty scene must be transparent');
		const ray = source({ position: [-0.4, 0.1] });
		const straight = await square.render({ sources: [ray] });
		assert(alphaAt(straight, 192, 192, 0.2, 0.1) > 0.1 && alphaAt(straight, 192, 192, 0.2, -0.1) === 0, 'straight ray or Y orientation');
		checks.push('transparent empty scene', 'single ray and Y orientation');

		// 【遮蔽物と45度の鏡】反射する位置と方向を既知の直線で検証する。
		const wall = field(192, 192, x => Math.abs(x) - 0.01);
		const blocked = await square.render({ sources: [ray], objects: [object(wall, { material: 'absorber' })] });
		assert(alphaAt(blocked, 192, 192, -0.2, 0.1) > 0.1 && alphaAt(blocked, 192, 192, 0.2, 0.1) === 0, 'absorber leaks');
		const diagonal = field(192, 192, (x, y) => Math.abs((x - y) / Math.SQRT2) - 0.005);
		const reflected = await square.render({ sources: [ray], objects: [object(diagonal, { material: 'mirror' })] });
		assert(alphaAt(reflected, 192, 192, 0.1 - Math.SQRT2 * 0.005, 0.3) > 0.1 && alphaAt(reflected, 192, 192, 0.3, 0.1) === 0, 'mirror direction');
		const dimMirror = await square.render({ sources: [ray], objects: [object(diagonal, { material: 'mirror', reflectivity: 0.25 })] });
		assert(alphaAt(dimMirror, 192, 192, 0.1 - Math.SQRT2 * 0.005, 0.3) < alphaAt(reflected, 192, 192, 0.1 - Math.SQRT2 * 0.005, 0.3) * 0.4, 'mirror reflectivity');
		checks.push('opaque blocker', 'specular reflection', 'mirror reflectivity');

		// 【Snellの法則とFresnel反射率】半空間の境界で、既知の屈折角と分岐した光量を確認する。
		const halfSpace = field(192, 192, x => -x);
		const angled = source({ position: [-0.4, 0.1], direction: 1 / 12 });
		const refracted = await square.render({ sources: [angled], objects: [object(halfSpace)], maxInteractions: 1 });
		const incidentAngle = Math.PI / 6;
		const transmittedAngle = Math.asin(Math.sin(incidentAngle) / 1.5);
		const boundaryY = 0.1 - 0.4 * Math.tan(incidentAngle);
		const expectedY = boundaryY - 0.3 * Math.tan(transmittedAngle);
		const transmittedSection = crossSection(refracted, 192, 192, 0.3);
		near(transmittedSection.center, expectedY, 0.006, 'Snell transmitted position');
		const reflectedY = boundaryY - 0.2 * Math.tan(incidentAngle);
		const reflectedSection = crossSection(refracted, 192, 192, -0.2, reflectedY - 0.03, reflectedY + 0.03);
		const s = (Math.cos(incidentAngle) - 1.5 * Math.cos(transmittedAngle)) / (Math.cos(incidentAngle) + 1.5 * Math.cos(transmittedAngle));
		const p = (1.5 * Math.cos(incidentAngle) - Math.cos(transmittedAngle)) / (1.5 * Math.cos(incidentAngle) + Math.cos(transmittedAngle));
		const fresnel = (s * s + p * p) / 2;
		near(reflectedSection.flux * Math.cos(incidentAngle) / angled.power, fresnel, 0.005, 'Fresnel reflected power');
		near(transmittedSection.flux * Math.cos(transmittedAngle) / angled.power, 1 - fresnel, 0.04, 'Fresnel transmitted power');
		checks.push('Snell refraction', 'Fresnel splitting and conserved power');
		const pruned = await square.render({ sources: [angled], objects: [object(halfSpace)], minimumRelativePower: 0.1 });
		assert(crossSection(pruned, 192, 192, -0.2, reflectedY - 0.03, reflectedY + 0.03).flux === 0, 'weak reflection not pruned');
		const matchedIor = await square.render({ sources: [angled], objects: [object(halfSpace)], exteriorIor: 1.5 });
		near(crossSection(matchedIor, 192, 192, 0.3).center, 0.1 - 0.7 * Math.tan(incidentAngle), 0.006, 'matched exterior IOR');
		checks.push('relative branch threshold', 'exterior refractive index');

		// 【内部光源と全反射】光源位置から初期媒質を判定し、臨界角を超える光を外へ漏らさない。
		const internal = source({ position: [0.15, -0.2], direction: 2 / 3 });
		const tir = await square.render({ sources: [internal], objects: [object(halfSpace)], maxInteractions: 1 });
		assert(alphaAt(tir, 192, 192, 0.2, -0.2 + 0.35 * Math.sqrt(3)) > 0.05, 'total internal reflection missing');
		assert(crossSection(tir, 192, 192, -0.05).flux === 0, 'total internal reflection leaks');
		checks.push('internal light source', 'total internal reflection');

		// 【距離に応じた吸収と媒質からの退出】平行平板を通る主透過光はexp(-係数*厚さ)で減衰する。
		const slab = field(192, 192, x => Math.abs(x) - 0.15);
		const slabSettings = { sources: [source()], maxInteractions: 2 };
		const clearSlab = await square.render({ ...slabSettings, objects: [object(slab)] });
		const absorbed = await square.render({ ...slabSettings, objects: [object(slab, { absorptionGreen: 3 })] });
		near(crossSection(absorbed, 192, 192, 0.3).flux / crossSection(clearSlab, 192, 192, 0.3).flux, Math.exp(-0.3 * 3), 0.015, 'Beer absorption');
		checks.push('exit refraction and distance-dependent absorption');

		// 【複数の鏡と相互作用上限】別々の物体を繰り返し反射し、回数制限を超えた経路は描かない。
		const upper = field(192, 192, (_x, y) => Math.abs(y - 0.15) - 0.003);
		const lower = field(192, 192, (_x, y) => Math.abs(y + 0.15) - 0.003);
		const mirrors = [object(upper, { material: 'mirror' }), object(lower, { material: 'mirror' })];
		const bouncing = source({ position: [-0.35, 0], direction: -1 / 8 });
		const multiple = await square.render({ sources: [bouncing], objects: mirrors, maxInteractions: 6 });
		const limited = await square.render({ sources: [bouncing], objects: mirrors, maxInteractions: 1 });
		assert(crossSection(multiple, 192, 192, 0.25).flux > 0.001 && crossSection(limited, 192, 192, 0.25).flux === 0, 'multiple mirrors or interaction limit');
		checks.push('multiple objects and repeated reflections', 'interaction limit');

		// 【両凸レンズの集光】実形状を持つレンズが平行光の幅を小さくすることを確認する。
		const lens = field(192, 192, (x, y) => Math.max(Math.hypot(x - 0.12, y) - 0.23, Math.hypot(x + 0.12, y) - 0.23));
		const beam = source({ type: 'parallelBeam', width: 0.16 });
		const focused = await square.render({ sources: [beam], objects: [object(lens)], raySamples: 96, maxInteractions: 6, pathBudget: 8192 });
		const initialWidth = crossSection(focused, 192, 192, -0.25).deviation;
		let focusedWidth = initialWidth;
		for (let x = 0.15; x <= 0.4; x += 0.01) focusedWidth = Math.min(focusedWidth, crossSection(focused, 192, 192, x).deviation);
		assert(focusedWidth < initialWidth * 0.25, `lens does not focus: ${focusedWidth}/${initialWidth}`);
		checks.push('biconvex lens focusing');

		// 【プリズムと分光色】短波長が強く曲がり、白色光を分散すると異なる位置へ色が現れる。
		const triangle = field(192, 192, (x, y) => {
			const vertices = [[-0.12, -0.18], [0.12, -0.18], [0, 0.2]];
			let distance = Infinity;
			let inside = true;
			for (let index = 0; index < 3; index++) {
				const a = vertices[index]; const b = vertices[(index + 1) % 3];
				const dx = b[0] - a[0]; const dy = b[1] - a[1];
				const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
				distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
				inside &&= dx * (y - a[1]) - dy * (x - a[0]) >= 0;
			}
			return inside ? -distance : distance;
		});
		const prism = object(triangle, { dispersion: 0.03 });
		const blue = await square.render({ sources: [source({ wavelength: 450 })], objects: [prism] });
		const red = await square.render({ sources: [source({ wavelength: 650 })], objects: [prism] });
		const blueCenter = crossSection(blue, 192, 192, 0.35).center;
		const redCenter = crossSection(red, 192, 192, 0.35).center;
		assert(blueCenter < redCenter - 0.006, `prism dispersion missing: ${blueCenter}/${redCenter}`);
		const rainbow = await square.render({ sources: [source({ spectrum: 'white', power: 0.015 })], objects: [prism], wavelengthSamples: 27, lineWidth: 0.004 });
		assert(rainbow.some((value, index) => index % 4 === 0 && Math.abs(value - rainbow[index + 2]) > 0.01), 'white prism stays gray');
		checks.push('prism dispersion', 'white spectral colors');

		// 【品質変更でも白色の総光量を保つ】光線数・分光数を増やすだけで明るくならない。
		const whiteBeam = source({ type: 'parallelBeam', spectrum: 'white', power: 0.02, width: 0.2 });
		const lowSamples = await square.render({ sources: [whiteBeam], raySamples: 32, wavelengthSamples: 3 });
		const highSamples = await square.render({ sources: [whiteBeam], raySamples: 128, wavelengthSamples: 27, pathBudget: 8192 });
		near(crossSection(lowSamples, 192, 192, 0.2).flux, whiteBeam.power, 0.001, 'beam power');
		near(crossSection(highSamples, 192, 192, 0.2).flux / crossSection(lowSamples, 192, 192, 0.2).flux, 1, 0.02, 'sample normalization');
		let whiteError = 0;
		for (let index = 0; index < highSamples.length; index += 4) whiteError = Math.max(whiteError, Math.abs(highSamples[index] - highSamples[index + 1]), Math.abs(highSamples[index] - highSamples[index + 2]));
		assert(whiteError < 0.003, `white spectrum not neutral: ${whiteError}`);
		checks.push('ray and wavelength sample normalization', 'white balance');

		// 【点光源と画面外の光源】有限の放射角度と、描画領域へ入る経路のクリップを確認する。
		const point = await square.render({ sources: [source({ type: 'pointSource', position: [0, 0], spread: 0.25, power: 0.02 })], raySamples: 64 });
		assert(alphaAt(point, 192, 192, 0.3, 0.1) > 0 && alphaAt(point, 192, 192, -0.3, 0.1) === 0, 'point source cone');
		const outside = await square.render({ sources: [source({ position: [-0.8, 0.1] })] });
		near(crossSection(outside, 192, 192, 0.2).flux, crossSection(straight, 192, 192, 0.2).flux, 0.0001, 'outside source clipping');
		checks.push('point source cone', 'outside source');

		// 【履歴非依存と入力更新】光源・配列長・入力種別を切り替えても古い光路を残さない。
		const repeated = await square.render({ sources: [ray] }, 99);
		assert(straight.every((value, index) => value === repeated[index]), 'time or history dependence');
		const budgetLimited = await square.render({ sources: [ray], objects: [object(diagonal, { material: 'mirror' })], pathBudget: 1 });
		assert(alphaAt(budgetLimited, 192, 192, 0.1 - Math.SQRT2 * 0.005, 0.3) === 0, 'path budget ignored');
		assert((await square.render({ sources: [ray], lineWidth: 0 })).every(value => value === 0), 'zero line width leaves stale paths');
		assert((await square.render({ sources: [ray], objects: [object(constantShaderInput('scalar', -1), { material: 'absorber' })] })).every(value => value === 0), 'inside opaque object must not emit');
		assert((await square.render()).every(value => value === 0), 'source removal leaves stale paths');
		const exhausted = await square.render({ sources: [ray], maximumSteps: 1 });
		assert(alphaAt(exhausted, 192, 192, 0.2, 0.1) === 0, 'trace iteration limit extends through unchecked space');
		const intense = await square.render({ sources: [source({ spectrum: 'white', power: 10000 })], wavelengthSamples: 27, exposure: 10 });
		assert(intense.some(value => value > 1000), 'HDR paths were clipped to SDR');
		const weak = await square.render({ sources: [source({ power: 1e-8 })] });
		assert(alphaAt(weak, 192, 192, 0.2, 0) > 0, 'weak light alpha cancelled to zero');
		checks.push('history independence', 'deterministic path budget', 'zero width and input removal', 'uniform SDF and opaque interior');
		checks.push('trace iteration limit', 'finite HDR accumulation', 'weak premultiplied alpha');

		// 【解像度・縦横比・32bitのSDF】共通座標で同じ反射位置と総パワーを保つ。
		const wide = effect(384, 192);
		const wideDiagonal = field(384, 192, (x, y) => Math.abs((x - y) / Math.SQRT2) - 0.005, precise);
		const wideReflection = await wide.render({ sources: [source({ position: [-0.4, 0] })], objects: [object(wideDiagonal, { material: 'mirror' })] });
		assert(alphaAt(wideReflection, 384, 192, -Math.SQRT2 * 0.005, 0.15) > 0.1, 'aspect ratio or data precision');
		const fullShape = field(4, 4, () => -0.1);
		assert(fullShape.kind === 'texture', 'test requires texture SDF');
		const transparentShape = { ...fullShape, fitMode: 'contain', wrapMode: 'transparent' } as ShaderInput;
		const clippedShape = await wide.render({ sources: [source()], objects: [object(transparentShape, { material: 'absorber' })] });
		assert(alphaAt(clippedShape, 384, 192, -0.3, 0) > 0.1 && alphaAt(clippedShape, 384, 192, 0, 0) === 0, 'transparent SDF fit creates a false surface or loses rectangle');
		const emptyShape = field(4, 4, () => 65504);
		const emptyShapeOutput = await wide.render({ sources: [source()], objects: [object({ ...emptyShape, fitMode: 'contain', wrapMode: 'transparent' } as ShaderInput)] });
		assert(alphaAt(emptyShapeOutput, 384, 192, 0.3, 0) > 0.1, 'empty SDF becomes input rectangle');
		const large = effect(384, 384);
		const largeBeam = await large.render({ sources: [whiteBeam], raySamples: 128, wavelengthSamples: 9 });
		near(crossSection(largeBeam, 384, 384, 0.2).flux / crossSection(highSamples, 192, 192, 0.2).flux, 1, 0.02, 'resolution independence');
		checks.push('aspect ratio and data precision', 'resolution-independent power');
		checks.push('transparent SDF fit and rectangle clipping', 'empty SDF sentinel');

		// 【目視用の光路画像】レンズ・プリズム・多重反射を並べ、数値検証と同じ結果を確認できるようにする。
		const panels = [focused, rainbow, multiple];
		const canvas = new OffscreenCanvas(192 * panels.length, 192);
		const context = canvas.getContext('2d')!;
		for (const [panelIndex, pixels] of panels.entries()) {
			const image = new Uint8ClampedArray(192 * 192 * 4);
			for (let index = 0; index < pixels.length; index += 4) {
				for (let channel = 0; channel < 3; channel++) image[index + channel] = 255 * Math.pow(Math.max(0, pixels[index + channel]) / (Math.max(0, pixels[index + channel]) + 0.08), 1 / 2.2);
				image[index + 3] = 255;
			}
			context.putImageData(new ImageData(image, 192, 192), panelIndex * 192, 0);
		}
		const blob = await canvas.convertToBlob();
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
		return { checks, preview: btoa(binary) };
	} finally {
		for (const dispose of owned.reverse()) dispose();
		device.destroy();
	}
}
