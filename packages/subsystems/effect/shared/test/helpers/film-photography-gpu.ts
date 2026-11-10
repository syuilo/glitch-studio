import definition from '../../src/fx/filmPhotography/_def_.ts';
import implementation from '../../src/fx/filmPhotography/_impl_.ts';
import { createFilmPhotographyModel, DEFAULT_SETTINGS, renderFilmColor } from '../../src/fx/filmPhotography/model.ts';
import type { FilmPhotographySettings } from '../../src/fx/filmPhotography/model.ts';
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
	const defaults: Parameters = { ...DEFAULT_SETTINGS, input: constantShaderInput('color', [0, 0, 0, 0]), exposure: constantShaderInput('scalar', 0), printExposure: constantShaderInput('scalar', 0) };
	const owned: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.001) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const scalar = (value: number) => constantShaderInput('scalar', value);
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
			async render(overrides: Partial<Parameters> = {}, time = 0, readback = true) {
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor), createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
					createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				device.queue.submit([encoder.finish()]);
				const pixels = readback ? await read(output) : new Float32Array();
				if (!readback) await device.queue.onSubmittedWorkDone();
				const error = await device.popErrorScope();
				device.pushErrorScope('validation');
				if (error != null) throw new Error(error.message);
				return pixels;
			},
		};
	}

	const checkColor = (pixels: Float32Array, expected: readonly number[], label: string, offset = 0) => expected.forEach((value, channel) => near(pixels[offset + channel], value, label, 0.0015));

	function colorField(colors: number[][], width: number, height: number) {
		const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(colors.flat()), { bytesPerRow: width * 8 }, [width, height]);
		owned.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' });
	}

	function scalarField(values: number[]) {
		const texture = device.createTexture({ size: [values.length, 1], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: values.length * 2 }, [values.length, 1]);
		owned.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' });
	}

	try {
		const effect = createEffect(16, 1);
		// 【明度・有彩色・広色域・HDRを倍精度の全波長計算と比較する】
		// GPUは基底から露光を直接求めるため、分光復元を経るCPU経路と一致することを確認する。
		const colors = [[0, 0, 0], [0.001, 0.001, 0.001], [0.18, 0.18, 0.18], [1, 1, 1], [4, 4, 4], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [-0.1, 0.5, 0.2], [-3, 2, 0], [-1, -1, -1], [60000, 3, 0.1], [0.2, 0.4, 0.8]];
		const model = createFilmPhotographyModel(DEFAULT_SETTINGS);
		for (const rgb of colors) {
			checkColor(await effect.render({ input: constantShaderInput('color', [...rgb, 1]) }), [...renderFilmColor(rgb, model), 1], `reference ${rgb}`);
		}
		checks.push('neutral ramp', 'saturated colors', 'HDR without clipping', 'negative RGB', 'unsupported chromaticity projection');
		const textureInput = colorField(colors.map(rgb => [...rgb, 1]), 16, 1);
		const textureOutput = await effect.render({ input: textureInput });
		colors.forEach((rgb, index) => checkColor(textureOutput, [...renderFilmColor(Array.from(new Float16Array(rgb)), model), 1], `texture ${index}`, index * 4));
		checks.push('texture input');

		// 【半透明は未乗算で感光させ、alpha=0の発光は変更せず保持する】
		// 被覆率を露光量へ混ぜると、半透明のエッジだけ異なる色になる。
		const rgb = [0.2, 0.4, 0.8];
		const expected = renderFilmColor(rgb, model);
		checkColor(await effect.render({ input: constantShaderInput('color', [...rgb, 0.25]) }), [...expected.map(value => value * 0.25), 0.25], 'premultiplied uniform');
		checkColor(await effect.render({ input: colorField([[...rgb.map(value => value * 0.25), 0.25]], 1, 1) }), [...renderFilmColor(Array.from(new Float16Array(rgb)), model).map(value => value * 0.25), 0.25], 'premultiplied texture');
		checkColor(await effect.render(), [0, 0, 0, 0], 'transparent black');
		checkColor(await effect.render({ input: { kind: 'uniform', value: [0.25, 0.125, 0.5, 0] } }), [0.25, 0.125, 0.5, 0], 'zero alpha emission');
		checks.push('premultiplied uniform', 'premultiplied texture', 'transparent black', 'zero-alpha emission');

		// 【露出の場と材料の変更を再描画へ反映し、基準への復帰で前の係数を残さない】
		// 露出だけの変更は材料キャッシュを再生成せず、材料のアニメーションは係数を更新する。
		const exposures = Array.from({ length: 16 }, (_, index) => index - 8);
		const filmExposurePixels = await effect.render({ input: constantShaderInput('color', [...rgb, 1]), exposure: scalarField(exposures) });
		const printExposurePixels = await effect.render({ input: constantShaderInput('color', [...rgb, 1]), printExposure: scalarField(exposures) });
		exposures.forEach((exposure, index) => {
			checkColor(filmExposurePixels, [...renderFilmColor(rgb, model, exposure), 1], 'film exposure field', index * 4);
			checkColor(printExposurePixels, [...renderFilmColor(rgb, model, 0, exposure), 1], 'print exposure field', index * 4);
		});
		checks.push('film exposure field', 'print exposure field');
		const variants: FilmPhotographySettings[] = [
			{ ...DEFAULT_SETTINGS, redLayer: { ...DEFAULT_SETTINGS.redLayer, sensitivityCenter: 570, sensitivityWidth: 20, dyeCenter: 620, secondaryAbsorption: 0.4 } },
			{ ...DEFAULT_SETTINGS, greenLayer: { ...DEFAULT_SETTINGS.greenLayer, speed: -1, gamma: 1.2, toe: 0.5, shoulder: 8 } },
			{ ...DEFAULT_SETTINGS, blueLayer: { ...DEFAULT_SETTINGS.blueLayer, maximumDensity: 0, fog: 0.3 } },
			{ ...DEFAULT_SETTINGS, base: { ...DEFAULT_SETTINGS.base, stain: 0.4 }, printer: { temperature: 6500, cyan: 0.1, magenta: 0.2, yellow: 0.3 } },
			{ ...DEFAULT_SETTINGS, paper: { ...DEFAULT_SETTINGS.paper, gamma: 1.1, toe: 4, shoulder: 0.4 } },
			{ ...DEFAULT_SETTINGS, paper: { ...DEFAULT_SETTINGS.paper, maximumDensity: 0 } },
			{
				...DEFAULT_SETTINGS,
				redLayer: { ...DEFAULT_SETTINGS.redLayer, speed: 24, gamma: 10, fog: 4, maximumDensity: 8, dyeCenter: 780, dyeWidth: 200, secondaryCenter: 380, secondaryWidth: 200, secondaryAbsorption: 1 },
				greenLayer: { ...DEFAULT_SETTINGS.greenLayer, speed: 24, gamma: 10, fog: 4, maximumDensity: 8, dyeCenter: 780, dyeWidth: 200, secondaryCenter: 380, secondaryWidth: 200, secondaryAbsorption: 1 },
				blueLayer: { ...DEFAULT_SETTINGS.blueLayer, speed: 24, gamma: 10, fog: 4, maximumDensity: 8, dyeCenter: 780, dyeWidth: 200, secondaryCenter: 380, secondaryWidth: 200, secondaryAbsorption: 1 },
				base: { ...DEFAULT_SETTINGS.base, density: 4, stain: 4, stainWidth: 200 },
				paper: { ...DEFAULT_SETTINGS.paper, toe: 0.1 },
			},
			DEFAULT_SETTINGS,
		];
		for (const settings of variants) {
			checkColor(await effect.render({ ...settings, input: constantShaderInput('color', [...rgb, 1]), exposure: scalar(0.4), printExposure: scalar(-0.7) }), [...renderFilmColor(rgb, createFilmPhotographyModel(settings), 0.4, -0.7), 1], 'material update');
		}
		checks.push('sensitivity and dye edits', 'development edits', 'zero film density', 'base and print filters', 'paper response', 'zero paper density', 'dense negative underflow', 'coefficient cache reset');
		for (const [width, height] of [[1, 1], [8, 16], [32, 8]]) {
			checkColor(await createEffect(width, height).render({ input: constantShaderInput('color', [...rgb, 1]) }, 123), [...expected, 1], 'resolution, aspect and time independence');
		}
		checks.push('resolution independence', 'aspect independence', 'time independence', '16-bit float output');
		// 【GPU完了までの時間を読み戻し・初回コンパイルと分けて観測する】
		// ハードウェア依存のため閾値を合否にせず、リアルタイム用途の計算コストを診断に残す。
		const fullHd = createEffect(1920, 1080);
		const performanceInput = { input: textureInput };
		await fullHd.render(performanceInput, 0, false);
		const frameDurations: number[] = [];
		for (let index = 0; index < 5; index++) {
			const started = performance.now();
			await fullHd.render(performanceInput, 0, false);
			frameDurations.push(performance.now() - started);
		}
		frameDurations.sort((a, b) => a - b);

		// 比較用の色票。上半分を入力、下半分を処理結果とし、横方向に露光量を振る。
		const width = 512;
		const height = 256;
		const chart = Array.from({ length: width * height }, (_, index) => {
			const x = index % width;
			const row = Math.floor(index / width);
			const color = colors[2 + Math.floor(row / 32) % 8];
			const exposure = 2 ** (x / width * 8 - 4);
			return [...color.map(value => value * exposure), 1];
		});
		const rendered = await createEffect(width, height).render({ input: colorField(chart, width, height) });
		const canvas = new OffscreenCanvas(width, height * 2);
		const encode = (value: number) => Math.round(255 * Math.max(0, Math.min(1, value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055)));
		const image = new Uint8ClampedArray(width * height * 8);
		chart.flat().forEach((value, index) => { image[index] = index % 4 === 3 ? 255 : encode(value); });
		rendered.forEach((value, index) => { image[width * height * 4 + index] = index % 4 === 3 ? 255 : encode(value); });
		canvas.getContext('2d')!.putImageData(new ImageData(image, width, height * 2), 0, 0);
		const previewBytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, fullHdMedianMilliseconds: frameDurations[2], preview: btoa(Array.from(previewBytes, value => String.fromCharCode(value)).join('')) };
	} finally {
		for (const dispose of owned.reverse()) dispose();
		device.destroy();
	}
}
