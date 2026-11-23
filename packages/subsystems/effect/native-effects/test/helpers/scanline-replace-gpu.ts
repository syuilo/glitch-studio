import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/scanlineReplace/_def_.ts';
import implementationNative from '../../src/fx/scanlineReplace/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.002) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const colorA = [2, -1, 0.5, 0.5];
	const colorB = [-0.5, 1, 0, 0.25];
	const defaults: Parameters = {
		inputA: constantShaderInput('color', [4, -2, 1, 0.5]),
		inputB: constantShaderInput('color', [-2, 4, 0, 0.25]),
		progress: scalar(0.5), bandSize: 0.125, stagger: 1, softness: 0.15,
		displacement: 0.05, chromaticShift: 0.003, seed: 0, sizeReference: 'longSide',
	};
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module: vertex },
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

	function field(width: number, height: number, colors: number[], scalarTexture = false, filterMode: 'linear' | 'nearest' = 'nearest') {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(colors), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode, fitMode: 'stretch', wrapMode: 'repeat' });
	}

	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.createTexture('output', { wgpu, resolution });
		const instance = implementation.place(wgpu, resolution);
		disposables.push(() => { instance.dispose(); output.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			await instance.draw({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputs: { output },
			});
			device.queue.submit([encoder.finish()]);
			const result = await read(output);
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(result.every(Number.isFinite), 'finite output');
			return result;
		};
	}

	const colorAt = (pixels: Float32Array, width: number, x: number, y: number) => pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4);
	const equal = (actual: Float32Array, expected: Float32Array, label: string, tolerance = 0.002) => {
		assert(actual.length === expected.length, label);
		actual.forEach((value, index) => near(value, expected[index], label, tolerance));
	};
	const spatialPattern = (width: number, height: number) => field(width, height, Array.from({ length: width * height }, (_, index) => {
		const x = (index % width + 0.5 - width / 2) / Math.max(width, height);
		const y = (height / 2 - Math.floor(index / width) - 0.5) / Math.max(width, height);
		return [x + 1, y + 1, x - 1, 0.5];
	}).flat(), false, 'linear');
	try {
		// 【進捗の端点ではHDR・負値・透明度を正確に保つ】
		// 変位や色ずれの値が大きくても元画像から始まり元画像で終わることを検証する。
		const render = createEffect(65, 33);
		for (const progress of [-1, 0, 1, 2]) {
			const pixels = await render({ progress: scalar(progress), displacement: 1, chromaticShift: 0.5 });
			pixels.forEach((value, index) => near(value, (progress <= 0 ? colorA : colorB)[index % 4], 'exact endpoint', 0));
		}
		const mixed = await render({ stagger: 0, displacement: 0, chromaticShift: 0 });
		mixed.forEach((value, index) => near(value, (colorA[index % 4] + colorB[index % 4]) / 2, 'premultiplied mix'));
		const transparent = await render({ stagger: 0, inputB: constantShaderInput('color', [8, -2, 1, 0]), displacement: 0, chromaticShift: 0 });
		transparent.forEach((value, index) => near(value, colorA[index % 4] / 2, 'transparent replacement'));
		checks.push('exact endpoints HDR alpha and transparent mixing');

		// 【同じ帯は同時に切り替わり、Staggerが0なら全帯が同時になる】
		// ランダムな値を画素ごとに生成して帯が壊れることや、seedを無視する誤りを検出する。
		const bands = await render({ softness: 0.4, displacement: 0, chromaticShift: 0 });
		for (let y = 0; y < 33; y++) {
			for (let x = 1; x < 65; x++) equal(colorAt(bands, 65, x, y), colorAt(bands, 65, 0, y), 'uniform horizontal band', 0);
		}
		equal(colorAt(bands, 65, 32, 15), colorAt(bands, 65, 32, 17), 'same central band', 0);
		const otherSeed = await render({ softness: 0.4, displacement: 0, chromaticShift: 0, seed: 19 });
		assert(bands.some((value, index) => Math.abs(value - otherSeed[index]) > 0.01), 'seed changes replacement order');
		equal(await render({ softness: 0.4, displacement: 0, chromaticShift: 0 }, 100), bands, 'time independent', 0);
		checks.push('uniform deterministic bands and seed');

		// 【Softnessが0なら帯ごとの硬い置換のみ行う】
		// 局所切替区間が存在しない設定で歪みだけが残り続けることを防ぐ。
		const hard = await render({ softness: 0, displacement: 1, chromaticShift: 1 });
		for (let index = 0; index < hard.length; index += 4) {
			const isA = hard[index] === colorA[0];
			const expected = isA ? colorA : colorB;
			for (let channel = 0; channel < 4; channel++) near(hard[index + channel], expected[channel], 'hard replacement', 0);
		}
		checks.push('hard switch disables transitional distortion');

		// 【横ずれは局所切替中だけ現れ、距離に比例する】
		// 座標勾配を使い、変位量を倍にしたときに横ずれだけが倍になることを確認する。
		const pattern = spatialPattern(65, 33);
		const transition = { inputA: pattern, inputB: pattern, stagger: 0, softness: 0.5, chromaticShift: 0, progress: scalar(5 / 12) };
		const unshifted = await render({ ...transition, displacement: 0 });
		const shifted = await render({ ...transition, displacement: 0.05 });
		const doubleShifted = await render({ ...transition, displacement: 0.1 });
		const centerIndex = (16 * 65 + 32) * 4;
		const delta = shifted[centerIndex] - unshifted[centerIndex];
		assert(Math.abs(delta) > 0.001, 'actual texture displacement');
		near(doubleShifted[centerIndex] - unshifted[centerIndex], delta * 2, 'linear displacement', 0.003);
		near(shifted[centerIndex + 1], unshifted[centerIndex + 1], 'horizontal only');
		for (const progress of [0.1, 0.9]) {
			const settled = await render({ ...transition, progress: scalar(progress), displacement: 0.5 });
			const settledBaseline = await render({ ...transition, progress: scalar(progress), displacement: 0 });
			equal(settled, settledBaseline, 'no distortion outside local transition', 0);
		}
		checks.push('localized horizontal displacement');

		// 【色ずれ先にだけある被覆もalphaへ含める】
		// 透明な画素から不透明部分へ赤だけずらした場合に、alphaが0のまま色だけ出る誤りを防ぐ。
		const edgeValues = Array.from({ length: 64 * 32 }, (_, index) => index % 64 >= 32 ? [2, 3, 4, 1] : [0, 0, 0, 0]).flat();
		const edge = field(64, 32, edgeValues);
		const edgeRender = createEffect(64, 32);
		const chromatic = await edgeRender({ inputA: edge, inputB: edge, stagger: 0, displacement: 0, chromaticShift: 0.1 });
		const pixel = colorAt(chromatic, 64, 31, 16);
		[2, 0, 0, 1].forEach((value, channel) => near(pixel[channel], value, 'chromatic coverage', 0));
		const noChromatic = await edgeRender({ inputA: edge, inputB: edge, stagger: 0, displacement: 0, chromaticShift: 0 });
		equal(colorAt(noChromatic, 64, 31, 16), new Float32Array([0, 0, 0, 0]), 'chromatic disabled', 0);
		checks.push('chromatic channels preserve displaced coverage');

		// 【Progressは出力位置のscalar場として読まれる】
		// 画像を移動するコードへ接続しても進捗場自体をずらさず、0/1が正しい画像を選ぶ。
		const localRender = createEffect(8, 4);
		const valuesA = Array.from({ length: 32 }, (_, index) => [index / 4, -0.25, 0.5, 0.5]).flat();
		const inputA = field(8, 4, valuesA);
		const progress = field(8, 4, Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1), true);
		const local = await localRender({ inputA, progress });
		for (let index = 0; index < 32; index++) {
			for (let channel = 0; channel < 4; channel++) near(local[index * 4 + channel], index % 8 < 4 ? valuesA[index * 4 + channel] : colorB[channel], 'local progress', 0);
		}
		checks.push('texture input and spatial progress');

		// 【同じ共通座標は解像度によらず同じ帯・変位になる】
		// 3倍解像度で一致する画素中心を比較する。縦長でも横ずれの距離単位は長辺基準。
		for (const [width, height] of [[33, 17], [17, 33]]) {
			const lowPattern = spatialPattern(width, height);
			const highPattern = spatialPattern(width * 3, height * 3);
			const parameters = { softness: 0.5, displacement: 0.025, chromaticShift: 0.01, seed: 3 };
			const low = await createEffect(width, height)({ ...parameters, inputA: lowPattern, inputB: lowPattern });
			const high = await createEffect(width * 3, height * 3)({ ...parameters, inputA: highPattern, inputB: highPattern });
			for (let y = 2; y < height - 2; y++) {
				for (let x = 2; x < width - 2; x++) equal(colorAt(low, width, x, y), colorAt(high, width * 3, x * 3 + 1, y * 3 + 1), 'resolution invariance', 0.003);
			}
		}
		const referenceRender = createEffect(64, 32);
		const referencePattern = spatialPattern(64, 32);
		const base = { inputA: referencePattern, inputB: referencePattern, softness: 0.5, bandSize: 0.1, displacement: 0.02, chromaticShift: 0.01 };
		const longSide = await referenceRender(base);
		const heightReference = await referenceRender({ ...base, sizeReference: 'height', bandSize: 0.2, displacement: 0.04, chromaticShift: 0.02 });
		equal(longSide, heightReference, 'size reference', 0);
		checks.push('aspect resolution and size reference');

		// 【正のSoftnessで端点近傍も元画像へ連続的に繋がる】
		// 強い歪みが最後のフレームだけ突然消える実装を検出する。
		for (const endpoint of [0, 1]) {
			const parameters = { inputA: pattern, softness: 0.8, displacement: 0.5, chromaticShift: 0.3 };
			const exact = await render({ ...parameters, progress: scalar(endpoint) });
			const close = await render({ ...parameters, progress: scalar(endpoint === 0 ? 0.000001 : 0.999999) });
			equal(close, exact, 'continuous endpoint', 0.003);
		}
		checks.push('continuous endpoints');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

