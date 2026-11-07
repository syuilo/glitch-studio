import definition from '../../src/fx/lcdViewingAngleAdvanced/_def_.ts';
import implementation from '../../src/fx/lcdViewingAngleAdvanced/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const owned: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.001) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => assert(actual.every((value, index) => value === expected[index]), label);
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const color = (value: readonly [number, number, number, number]) => constantShaderInput('color', value);
	const encode = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
	const decode = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	const checkColor = (pixels: Float32Array, expected: number[], label: string, offset = 0, tolerance = 0.001) => expected.forEach((value, channel) => near(pixels[offset + channel], value, label, tolerance));
	const readLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readLayout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});
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
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) pixels.set(padded.subarray(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4), row * width * 4);
			buffer.unmap();
			return pixels;
		} finally { target.destroy(); buffer.destroy(); }
	}
	function createEffect(width: number, height: number, format: IntermediateTextureFormat = 'rgba16float') {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: format, enable32bitDataTextures: false };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		owned.push(() => { instance.dispose(); output.destroy(); });
		return {
			async render(overrides: Partial<Parameters> = {}, time = 0) {
				let passes = 0;
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor), createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
					createPassEncoderFor: (commandEncoder, view) => { passes++; return commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }); },
				});
				device.queue.submit([encoder.finish()]);
				const pixels = await read(output);
				const error = await device.popErrorScope();
				device.pushErrorScope('validation');
				if (error != null) throw new Error(error.message);
				return { pixels, passes };
			},
		};
	}
	function colorField(width: number, height: number, value: (x: number, y: number) => readonly number[]) {
		const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const values = Float16Array.from({ length: width * height * 4 }, (_, index) => value(Math.floor(index / 4) % width, Math.floor(index / 4 / width))[index % 4]);
		device.queue.writeTexture({ texture }, values, { bytesPerRow: width * 8 }, [width, height]);
		owned.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' });
	}
	function amountField(width: number) {
		const texture = device.createTexture({ size: [width, 1], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, Float16Array.from({ length: width }, (_, index) => index / (width - 1)), { bytesPerRow: width * 2 }, [width, 1]);
		owned.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' });
	}
	// 一様な板の解析解。GPUの層別Jones更新とは独立に、2つの固有偏光の
	// 位相差から最終透過強度を直接計算する。斜入射ではSnellの法則も含める。
	function uniformPlate(horizontalAngle: number) {
		const internalCosine = Math.sqrt(1 - (Math.sin(horizontalAngle) / 1.5) ** 2);
		const centers = [610, 545, 460];
		const widths = [25, 22, 20];
		return centers.map((center, channel) => {
			let response = 0;
			let total = 0;
			for (let wavelength = 380; wavelength <= 780; wavelength += 5) {
				const weight = Math.exp(-0.5 * ((wavelength - center) / widths[channel]) ** 2) * (wavelength === 380 || wavelength === 780 ? 0.5 : 1);
				const phase = 2 * Math.PI * 500 * internalCosine / wavelength;
				const transmission = 0.5 * (1 + internalCosine ** 4 - 2 * internalCosine ** 2 * Math.cos(phase)) / (1 + internalCosine ** 2) ** 2;
				response += transmission * weight;
				total += weight;
			}
			return encode(response / total);
		});
	}
	function twistedCell() {
		return [610, 545, 460].map((center, channel) => {
			let response = 0;
			let total = 0;
			for (let wavelength = 380; wavelength <= 780; wavelength += 5) {
				const weight = Math.exp(-0.5 * ((wavelength - center) / [25, 22, 20][channel]) ** 2) * (wavelength === 380 || wavelength === 780 ? 0.5 : 1);
				const twist = Math.PI / 2;
				const halfRetardance = Math.PI * 500 / wavelength;
				const generalizedPhase = Math.hypot(twist, halfRetardance);
				const transmission = 0.5 * (1 - (twist / generalizedPhase * Math.sin(generalizedPhase)) ** 2);
				response += transmission * weight;
				total += weight;
			}
			return encode(response / total);
		});
	}
	try {
		const effect = createEffect(33, 1);
		const opaque = color([0.7, 0.4, 0.2, 1]);
		// 【正面校正はRGBの駆動を逆算し、任意の入力色と透明度を保つ】
		// 単に原画像へ色を掛ける方式では、液晶の階調応答や半透明部分を再現できない。
		const front = await effect.render({ input: opaque });
		checkColor(front.pixels, [0.7, 0.4, 0.2, 1], 'calibrated front view');
		assert(front.passes === 4, 'initial optical passes');
		const repeated = await effect.render({ input: opaque }, 1000);
		equal(repeated.pixels, front.pixels, 'time independence');
		assert(repeated.passes === 1, 'reuse optical responses');
		checks.push('calibrated front view', 'history independence', 'response reuse');
		const grayscale = colorField(33, 1, x => [x / 32, x / 32, x / 32, 1]);
		const calibratedRamp = await effect.render({ input: grayscale });
		for (let x = 0; x < 33; x++) checkColor(calibratedRamp.pixels, [x / 32, x / 32, x / 32, 1], 'calibrated grayscale', x * 4);
		checks.push('full grayscale calibration');

		// 【光学応答を無くした極限ではMalusの法則に戻り、駆動値にも依存しない】
		// 正面校正が不可能な設定でのゼロ除算や、暗さをalphaへ反映する誤りを防ぐ。
		for (const material of [{ cellThickness: 0 }, { ordinaryIor: 1.5, extraordinaryIor: 1.5 }]) {
			for (const angle of [0, 0.125, 0.25]) {
				const rendered = await effect.render({ ...material, input: opaque, analyzerAngle: angle, brightness: 1 });
				const expected = encode(0.5 * Math.cos(angle * 2 * Math.PI) ** 2);
				checkColor(rendered.pixels, [expected, expected, expected, 1], 'Malus law and degenerate calibration');
			}
		}
		checks.push('zero thickness', 'zero birefringence', 'Malus law', 'degenerate calibration');

		// 【一様な複屈折板の正面・斜入射を分光積分した解析解と比較する】
		// 波長・µmの換算、屈折による位相差、投影後の偏光軸、複素振幅の更新を検証する。
		for (const angle of [0, 1 / 6]) {
			const rendered = await effect.render({ input: color([1, 1, 1, 1]), calibrateFrontView: false, brightness: 1, twistAngle: 0, pretiltAngle: 0, polarizerAngle: 0.125, analyzerAngle: 0.375, horizontalViewingAngle: angle });
			checkColor(rendered.pixels, [...uniformPlate(angle * 2 * Math.PI), 1], 'uniform plate analytical spectrum', 0, 0.0015);
		}
		checks.push('normal spectral retardance', 'oblique refraction and polarization');
		// 【一様な90°ねじれのTNセルを連続体の解析解と比較する】
		// 層を順に通す計算の順序・ねじれ角と、固定分割数での離散化精度を確認する。
		const twisted = await effect.render({ input: color([1, 1, 1, 1]), calibrateFrontView: false, brightness: 1, pretiltAngle: 0 });
		checkColor(twisted.pixels, [...twistedCell(), 1], 'continuous uniformly twisted cell', 0, 0.001);
		checks.push('continuous twisted-cell analytical solution');
		const crossed = await effect.render({ input: opaque, calibrateFrontView: false, brightness: 1 });
		const parallel = await effect.render({ input: opaque, calibrateFrontView: false, brightness: 1, analyzerAngle: 0 });
		for (let channel = 0; channel < 3; channel++) near(decode(crossed.pixels[channel]) + decode(parallel.pixels[channel]), 0.5, 'conservation of transmitted energy');
		checks.push('lossless-layer energy conservation');

		// 【視線の正負で応答が異なり、RGBの差と非単調な階調が光学計算から現れる】
		// 絶対角度だけを使う近似や、単なるガンマ補正へ置き換わる退行を検出する。
		const upper = await effect.render({ input: grayscale, verticalViewingAngle: 1 / 6 });
		const lower = await effect.render({ input: grayscale, verticalViewingAngle: -1 / 6 });
		assert(upper.pixels.some((value, index) => Math.abs(value - lower.pixels[index]) > 0.05), 'signed viewing angle');
		assert(upper.pixels.some((value, index) => index % 4 === 0 && Math.abs(value - upper.pixels[index + 2]) > 0.025), 'spectral color shift');
		assert([upper.pixels, lower.pixels].some(pixels => Array.from({ length: 32 }, (_, x) => pixels[(x + 1) * 4] < pixels[x * 4] - 0.005).some(value => value === true)), 'partial grayscale inversion');
		checks.push('signed viewing angle', 'spectral color shift', 'grayscale inversion');
		const changedAngle = await effect.render({ input: grayscale, verticalViewingAngle: 0.1 });
		assert(changedAngle.passes === 3, 'view change preserves front response');
		const changedBrightness = await effect.render({ input: grayscale, verticalViewingAngle: 0.1, brightness: 1 });
		assert(changedBrightness.passes === 2, 'exposure change preserves optical responses');
		const changedMaterial = await effect.render({ input: grayscale, verticalViewingAngle: 0.1, cellThickness: 6 });
		assert(changedMaterial.passes === 4, 'material change rebuilds responses');
		checks.push('view cache invalidation', 'exposure cache invalidation', 'material cache invalidation');

		// 【半透明色・透明画素・Amountの場を定数とテクスチャの両方で扱う】
		// 未乗算への変換漏れやalphaの二重乗算を防ぎ、混合が光量の空間で行われることも確認する。
		const translucent = color([0.7, 0.4, 0.2, 0.5]);
		const opaqueAngle = await effect.render({ input: opaque, verticalViewingAngle: 0.1 });
		const translucentAngle = await effect.render({ input: translucent, verticalViewingAngle: 0.1 });
		checkColor(translucentAngle.pixels, [...Array.from(opaqueAngle.pixels.slice(0, 3), value => value * 0.5), 0.5], 'premultiplied alpha');
		const literal = await effect.render({ input: color([0.5, 0.25, 0.125, 0.5]), verticalViewingAngle: 0.1 });
		const texture = await effect.render({ input: colorField(1, 1, () => [0.25, 0.125, 0.0625, 0.5]), verticalViewingAngle: 0.1 });
		equal(literal.pixels, texture.pixels, 'literal and texture agreement');
		checkColor((await effect.render({ input: color([0, 0, 0, 0]) })).pixels, [0, 0, 0, 0], 'transparent input');
		checkColor((await effect.render({ input: opaque, brightness: 0 })).pixels, [0, 0, 0, 1], 'zero brightness preserves alpha');
		checkColor((await effect.render({ input: opaque, amount: scalar(0), verticalViewingAngle: 0.1 })).pixels, [0.7, 0.4, 0.2, 1], 'zero amount');
		const mixed = await effect.render({ input: opaque, amount: amountField(33), verticalViewingAngle: 0.1 });
		for (let x = 0; x < 33; x++) {
			const amount = x / 32;
			const expected = [0.7, 0.4, 0.2].map((value, channel) => encode(decode(value) * (1 - amount) + decode(opaqueAngle.pixels[channel]) * amount));
			checkColor(mixed.pixels, [...expected, 1], 'spatial amount and linear-light mixing', x * 4, 0.0015);
		}
		checks.push('premultiplied alpha', 'literal and texture agreement', 'transparent input', 'zero brightness', 'zero amount', 'spatial amount and linear-light mixing');

		// 【解像度・縦横比・出力形式・角度の周期が光学量を変更しない】
		// 固定の応答表が画像サイズやサンプリング形式へ誤って依存することを防ぐ。
		const baseline = await effect.render({ input: opaque, horizontalViewingAngle: 0.1 });
		for (const [width, height] of [[1, 1], [8, 16], [32, 8]]) checkColor((await createEffect(width, height).render({ input: opaque, horizontalViewingAngle: 0.1 })).pixels, Array.from(baseline.pixels.slice(0, 4)), 'resolution and aspect independence');
		checkColor((await createEffect(1, 1, 'rgba8unorm').render({ input: opaque, horizontalViewingAngle: 0.1 })).pixels, Array.from(baseline.pixels.slice(0, 4)), '8bit output', 0, 1 / 255);
		equal(baseline.pixels, (await effect.render({ input: opaque, horizontalViewingAngle: 1.1 })).pixels, 'view angle periodicity');
		checkColor((await effect.render({ input: opaque, panelRotation: 0.25, verticalViewingAngle: -0.1 })).pixels, Array.from(baseline.pixels.slice(0, 4)), 'panel and viewing-direction rotation');
		const extreme = await effect.render({ input: opaque, horizontalViewingAngle: 0.25, verticalViewingAngle: -0.25 });
		assert(extreme.pixels.every(Number.isFinite), 'grazing-angle finite values');
		checks.push('resolution and aspect independence', 'image formats', 'angle periodicity', 'panel rotation', 'grazing-angle stability');

		const width = 384;
		const height = 96;
		const previewEffect = createEffect(width, height);
		const previewInput = colorField(width, height, (x, y) => {
			const value = x / (width - 1);
			if (y < 48) return [value, value, value, 1];
			if (y < 64) return [value, 0, 0, 1];
			if (y < 80) return [0, value, 0, 1];
			return [0, 0, value, 1];
		});
		const canvas = new OffscreenCanvas(width, height * 3);
		const context = canvas.getContext('2d')!;
		for (const [index, angle] of [0, 1 / 6, -1 / 6].entries()) {
			const preview = await previewEffect.render({ input: previewInput, verticalViewingAngle: angle });
			context.putImageData(new ImageData(Uint8ClampedArray.from(preview.pixels, value => Math.round(value * 255)), width, height), 0, index * height);
		}
		const previewBytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, preview: btoa(Array.from(previewBytes, value => String.fromCharCode(value)).join('')) };
	} finally {
		for (const dispose of owned.reverse()) dispose();
		device.destroy();
	}
}
