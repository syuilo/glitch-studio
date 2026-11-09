import definition from '../../src/fx/birefringence/_def_.ts';
import implementation from '../../src/fx/birefringence/_impl_.ts';
import thinFilmDefinition from '../../src/fx/thinFilmInterference/_def_.ts';
import thinFilmImplementation from '../../src/fx/thinFilmInterference/_impl_.ts';
import { createSpectralSamples } from '../../src/optics/spectral-samples.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';

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
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const half = (value: number) => new Float16Array([value])[0];
	const encodeSrgb = (value: number) => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
	const decodeSrgb = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	const samples = createSpectralSamples();
	// GPUの半位相の実部・虚部の式とは独立に、速軸・遅軸の複素振幅を足して強度を求める。
	function expectedColor(retardation: number, fastAxisAngle = 0.125, polarizerAngle = 0, analyzerAngle = 0.25) {
		const fastAmplitude = Math.cos((polarizerAngle - fastAxisAngle) * 2 * Math.PI) * Math.cos((analyzerAngle - fastAxisAngle) * 2 * Math.PI);
		const slowAmplitude = Math.sin((polarizerAngle - fastAxisAngle) * 2 * Math.PI) * Math.sin((analyzerAngle - fastAxisAngle) * 2 * Math.PI);
		const linear = [0, 0, 0];
		for (let index = 0; index < samples.length; index += 4) {
			const phase = 2 * Math.PI * retardation / samples[index + 3];
			const real = fastAmplitude + slowAmplitude * Math.cos(phase);
			const imaginary = slowAmplitude * Math.sin(phase);
			const transmission = 0.5 * (real * real + imaginary * imaginary);
			for (let channel = 0; channel < 3; channel++) linear[channel] += samples[index + channel] * transmission;
		}
		return linear.map(value => encodeSrgb(Math.max(0, Math.min(0.5, value))));
	}
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module: vertex },
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
			pass.setBindGroup(0, device.createBindGroup({ layout, entries: [{ binding: 0, resource: texture.createView() }] }));
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
	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === INTERMEDIATE_TEXTURE_FORMAT, 'fixed rgba16float image output');
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		owned.push(() => { instance.dispose(); output.destroy(); });
		return {
			async render(overrides: Partial<Parameters> = {}, time = 0) {
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor), createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
					createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				device.queue.submit([encoder.finish()]);
				const pixels = await read(output);
				const error = await device.popErrorScope();
				device.pushErrorScope('validation');
				if (error != null) throw new Error(error.message);
				return pixels;
			},
		};
	}
	function field(width: number, height: number, value: (x: number, y: number) => number) {
		const texture = device.createTexture({ size: [width, height], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const pixels = Float16Array.from({ length: width * height }, (_, index) => value(index % width, Math.floor(index / width)));
		device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 2 }, [width, height]);
		owned.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' });
	}
	const equal = (a: Float32Array, b: Float32Array, label: string) => assert(a.every((value, index) => value === b[index]), label);
	const checkColor = (pixels: Float32Array, expected: number[], label: string, offset = 0, tolerance = 0.001) => expected.forEach((value, channel) => near(pixels[offset + channel], value, label, tolerance));
	try {
		const effect = createEffect(17, 1);
		// 【光路差0は消光し、平行・斜交した偏光板ではMalusの法則に従う】
		// 最初の偏光板の1/2を含め、厚みや屈折率差を0にする操作を単なる色変化にしない。
		for (const settings of [{ input: scalar(0) }, { maximumThickness: 0 }, { birefringence: scalar(0) }]) checkColor(await effect.render(settings), [0, 0, 0, 1], 'zero-retardation extinction');
		for (const angle of [0, 0.125, 0.25]) {
			const expected = encodeSrgb(0.5 * Math.cos(angle * 2 * Math.PI) ** 2);
			checkColor(await effect.render({ birefringence: scalar(0), analyzerAngle: angle }), [expected, expected, expected, 1], 'Malus law');
		}
		checks.push('zero thickness', 'zero birefringence', 'Malus law and first polarizer loss');

		// 【可視域の干渉色を独立した複素振幅の計算と比較する】
		// µmとnmの換算、偏光板の任意角度、RGBの3波長だけでは作れない高次の色を確認する。
		for (const retardation of [100, 275, 500, 1000, 2000, 4000]) {
			checkColor(await effect.render({ minimumThickness: retardation / 10, maximumThickness: retardation / 10 }), [...expectedColor(retardation), 1], `spectral retardation ${retardation}`);
		}
		checkColor(await effect.render({ fastAxisAngle: scalar(-0.08), polarizerAngle: 0.04, analyzerAngle: 0.31 }), [...expectedColor(500, -0.08, 0.04, 0.31), 1], 'arbitrary polarizer angles');
		checks.push('spectral interference colors', 'arbitrary polarizer angles');

		// 【速軸に沿う光は消光し、軸の半回転・屈折率差の符号で強度が変わらない】
		// 方向を持たない軸を単なるRGBシフトとして扱う実装や、負の式入力での不連続を検出する。
		for (const angle of [0, 0.25]) checkColor(await effect.render({ fastAxisAngle: scalar(angle) }), [0, 0, 0, 1], 'aligned fast axis');
		const baseline = await effect.render();
		equal(baseline, await effect.render({ fastAxisAngle: scalar(0.625), polarizerAngle: 0.5, analyzerAngle: -0.25 }), 'half-turn periodicity');
		equal(baseline, await effect.render({ birefringence: scalar(-0.01) }), 'signed birefringence');
		checks.push('fast-axis extinction', 'axis periodicity', 'signed birefringence');

		// 【直交・平行の検光子で取り出す光量の和が、最初の偏光板を通った光量と一致する】
		// 波長で位相が変わっても複屈折板が光を増やさず、色計算をlinear RGBで行うことを確認する。
		const parallel = await effect.render({ analyzerAngle: 0 });
		for (let channel = 0; channel < 3; channel++) near(decodeSrgb(baseline[channel]) + decodeSrgb(parallel[channel]), 0.5, 'complementary analyzer energy');
		checks.push('complementary analyzer energy');

		// 【厚み・複屈折量・速軸・不透明度の場を同時にノード入力する】
		// 定数だけが正しく描画される状態を防ぎ、画素ごとの値と入力構成の切り替えを検証する。
		const texturePixels = await effect.render({ input: field(17, 1, x => x / 16), birefringence: field(17, 1, x => 0.002 + x / 1600), fastAxisAngle: field(17, 1, x => x / 32), opacity: field(17, 1, x => x / 16) });
		for (let x = 0; x < 17; x++) {
			const alpha = x / 16;
			const color = expectedColor(100000 * x / 16 * half(0.002 + x / 1600), x / 32);
			checkColor(texturePixels, [...color.map(value => value * alpha), alpha], 'spatially varying inputs', x * 4);
		}
		checkColor(await effect.render({ input: field(17, 1, () => 0.5), birefringence: field(17, 1, () => 0.01), fastAxisAngle: field(17, 1, () => 0.125) }), [...expectedColor(50000 * half(0.01)), 1], 'constant texture and literal precision');
		checks.push('spatially varying inputs', 'literal and texture agreement');

		// 【光源色とOpacityは乗算済みalphaを保ち、消光しても被覆率を失わない】
		// RGBの非線形変換へ乗算済み色を直接渡すと、半透明の素材で暗い縁が生じる。
		const lightColor = [0.4, 0.2, 0.1, 0.5] as const;
		const tinted = await effect.render({ lightColor: constantShaderInput('color', lightColor), opacity: scalar(0.4), birefringence: scalar(0), analyzerAngle: 0 });
		const expectedTint = [...lightColor.slice(0, 3).map(value => encodeSrgb(decodeSrgb(value) * 0.5) * 0.2), 0.2];
		checkColor(tinted, expectedTint, 'premultiplied light color');
		const colorTexture = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		owned.push(() => colorTexture.destroy());
		device.queue.writeTexture({ texture: colorTexture }, new Float16Array([0.2, 0.1, 0.05, 0.5]), { bytesPerRow: 8 }, [1, 1]);
		checkColor(await effect.render({ lightColor: textureShaderInput(colorTexture, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' }), opacity: scalar(0.4), birefringence: scalar(0), analyzerAngle: 0 }), expectedTint, 'premultiplied light texture');
		checkColor(await effect.render({ opacity: scalar(0) }), [0, 0, 0, 0], 'zero opacity');
		checkColor(await effect.render({ lightColor: constantShaderInput('color', [0, 0, 0, 0]) }), [0, 0, 0, 0], 'transparent light');
		checkColor(await effect.render({ brightness: 0 }), [0, 0, 0, 1], 'zero brightness preserves coverage');
		checks.push('premultiplied light and opacity', 'premultiplied light texture', 'transparent light', 'zero brightness');

		// 【厚みの範囲制限・逆向きの対応と、時間・解像度・形式の独立性】
		// 再描画やpipeline切り替えで前の入力を残さず、物理的な厚みを画面寸法で換算しない。
		checkColor(await effect.render({ input: scalar(-1) }), [0, 0, 0, 1], 'negative thickness input');
		equal(await effect.render({ input: scalar(1) }), await effect.render({ input: scalar(2) }), 'upper thickness clamp');
		equal(await effect.render({ input: scalar(0.25) }), await effect.render({ input: scalar(0.75), minimumThickness: 100, maximumThickness: 0 }), 'reversed thickness range');
		equal(baseline, await effect.render({}, 1000), 'history independence');
		for (const [width, height] of [[1, 1], [8, 16], [32, 8]]) checkColor(await createEffect(width, height).render(), Array.from(baseline.slice(0, 4)), 'resolution and aspect independence');
		checks.push('thickness range', 'history independence', 'resolution and aspect independence', '16-bit float image output');

		// 【分光重みを共通化したThin Film Interferenceも実際に描画する】
		// 同じ屈折率の膜と下地は界面反射がなく、透過は全波長で1になる既知のケースを使う。
		const resolution = { width: 1, height: 1 };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const thinFilmDefaults = Object.fromEntries(Object.entries(thinFilmDefinition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as RuntimeEffectParameters<typeof thinFilmDefinition.paramDefs>;
		const output = thinFilmImplementation.outputTextureFactories.output({ wgpu, resolution });
		const thinFilm = thinFilmImplementation.init({ wgpu, resolution, params: thinFilmDefaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		owned.push(() => { thinFilm.dispose(); output.destroy(); });
		const encoder = device.createCommandEncoder();
		thinFilm.render({ params: { ...thinFilmDefaults, filmIor: 1, substrateIor: 1, mode: 'transmission' }, commandEncoder: encoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
			outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
			createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor), createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
			createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
		});
		device.queue.submit([encoder.finish()]);
		checkColor(await read(output), [1, 1, 1, 1], 'thin-film shared spectrum');
		checks.push('thin-film shared spectrum regression');

		const width = 512;
		const height = 256;
		const previewPixels = await createEffect(width, height).render({ input: field(width, height, (x, y) => 0.5 + 0.23 * Math.sin(x / 50 + Math.sin(y / 44) * 2) + 0.23 * Math.cos(y / 36 + Math.cos(x / 74))), maximumThickness: 200 });
		const canvas = new OffscreenCanvas(width, height);
		canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(previewPixels, value => Math.round(value * 255)), width, height), 0, 0);
		const previewBytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, preview: btoa(Array.from(previewBytes, value => String.fromCharCode(value)).join('')) };
	} finally {
		for (const dispose of owned.reverse()) dispose();
		device.destroy();
	}
}
