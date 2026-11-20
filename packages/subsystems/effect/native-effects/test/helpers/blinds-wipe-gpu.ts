import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/blindsWipe/_def_.ts';
import implementationNative from '../../src/fx/blindsWipe/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

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
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => {
		assert(actual.length === expected.length, label);
		actual.forEach((value, index) => near(value, expected[index], label));
	};
	const scalar = (value: number) => constantShaderInput('scalar', value);
	// 未乗算の入力から期待する乗算済み色を明示する。HDR・負値・異なるalphaを含む。
	const inputA = constantShaderInput('color', [4, -2, 1, 0.5]);
	const inputB = constantShaderInput('color', [-2, 4, 0, 0.25]);
	const colorA = [2, -1, 0.5, 0.5];
	const colorB = [-0.5, 1, 0, 0.25];
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

	function textureInput(width: number, height: number, values: number[], scalarTexture = false) {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode: 'nearest', fitMode: 'stretch', wrapMode: 'clamp' });
	}


	function createEffect(width = 65, height = 65, precise = true) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const defaults = {
			...Object.fromEntries(Object.entries(definition.paramDefs).map(([key, parameter]) => [key,
				'canNode' in parameter && parameter.canNode === true
					? constantShaderInput(parameter.dataType.kind, parameter.defaultValue)
					: structuredClone(parameter.defaultValue),
			])),
			inputA, inputB, progress: scalar(0.5),
		};
		const textures = new Map<string, GPUTexture>();
		const instance = implementation.place(wgpu, resolution);
		disposables.push(() => { instance.dispose(); for (const texture of textures.values()) texture.destroy(); });
		return async (overrides: Record<string, unknown> = {}, mode: 'color' | 'mask' | 'both' = 'both', time = 0) => {
			const keys = mode === 'both' ? ['output', 'mask'] : [mode === 'color' ? 'output' : 'mask'];
			const outputs = Object.fromEntries(keys.map(key => {
				let texture = textures.get(key);
				if (texture == null) {
					texture = implementation.createTexture(key, { wgpu, resolution });
					textures.set(key, texture);
				}
				if (key === 'mask') assert(texture.format === (precise ? 'r32float' : 'r16float'), 'mask precision');
				return [key, texture];
			}));
			const encoder = device.createCommandEncoder();
			await instance.draw({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 }, outputs,
			});
			device.queue.submit([encoder.finish()]);
			const color = mode === 'mask' ? new Float32Array() : await read(textures.get('output')!);
			const maskPixels = mode === 'color' ? new Float32Array() : await read(textures.get('mask')!);
			const mask = Float32Array.from({ length: maskPixels.length / 4 }, (_, index) => maskPixels[index * 4]);
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(color.every(Number.isFinite), 'finite color');
			assert(mask.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'bounded finite mask');
			return { color, mask };
		};
	}

	try {
		// 【最大Feather・両方向の遅延でも端点が連続する】
		// 各帯の平均被覆率を求めるため、狭い開口や描画領域端に残像が出ないことを確認する。
		for (const precise of [false, true]) {
			const render = createEffect(33, 17, precise);
			for (const mode of ['oneSided', 'centered']) {
				for (const stagger of [-1, 0, 1]) {
					for (const progress of [0, 0.000001, 0.999999, 1]) {
						const result = await render({ mode, stagger, feather: 1, angle: 0.13, progress: scalar(progress) });
						const endpoint = progress < 0.5 ? 0 : 1;
						result.mask.forEach(value => near(value, endpoint, 'continuous mask endpoint'));
						result.color.forEach((value, index) => near(value, (endpoint === 0 ? colorA : colorB)[index % 4], 'continuous color endpoint'));
						if (progress === 0 || progress === 1) assert(result.mask.every(value => value === endpoint), 'exact mask endpoints');
					}
				}
			}
			checks.push(`${precise ? 32 : 16}bit staggered endpoints`);

			// 【画像とMaskが一致し、単独出力でも結果が変わらない】
			// 半透明画像の二重乗算、HDRのclamp、未確保ポートへのアクセスを検出する。
			const parameters = { feather: 0.04, stagger: 0.7, progress: scalar(0.41), mode: 'centered' };
			const baseline = await render(parameters);
			baseline.mask.forEach((mask, index) => {
				for (let channel = 0; channel < 4; channel++) near(baseline.color[index * 4 + channel], colorA[channel] * (1 - mask) + colorB[channel] * mask, 'mask matches color');
			});
			equal((await render(parameters, 'color')).color, baseline.color, 'color only');
			equal((await render(parameters, 'mask', 100)).mask, baseline.mask, 'mask only and deterministic');
			equal((await createEffect(33, 17, precise)(parameters, 'mask')).mask, baseline.mask, 'mask without image allocation');
			checks.push(`${precise ? 32 : 16}bit alpha HDR lazy outputs`);
		}

		// 【片側開放と中央開放の既知の区間】
		// Countが全幅に対する分割数で、中央開放が両側へ半分ずつ広がることを固定する。
		const render = createEffect(128, 32);
		for (const mode of ['oneSided', 'centered']) {
			const result = await render({ count: 4, mode, angle: 0.25 }, 'mask');
			for (let x = 0; x < 128; x++) {
				const local = x % 32;
				const expected = mode === 'oneSided' ? local < 16 : local >= 8 && local < 24;
				near(result.mask[16 * 128 + x], expected ? 1 : 0, 'known band opening');
			}
		}
		checks.push('one sided and centered intervals');

		// 【隣帯の異なる進捗を数値積分と比較する】
		// シェーダーの区間交差式を再実装せず、細かな二値サンプルを平均する。
		// 最大Feather・Staggerの両符号・帯の継ぎ目を含み、誤った周期化を検出する。
		for (const mode of ['oneSided', 'centered']) {
			for (const stagger of [-1, 1]) {
				for (const feather of [0.03, 1]) {
					const result = await render({ count: 4, mode, stagger, feather, angle: 0.25 }, 'mask');
					const filterPixels = Math.min(32, Math.max(1, feather * 128));
					for (const x of [0, 15, 31, 32, 47, 63, 64, 79, 95, 96, 111, 127]) {
						let expected = 0;
						const samples = 4096;
						for (let sample = 0; sample < samples; sample++) {
							const position = x + 0.5 + ((sample + 0.5) / samples - 0.5) * filterPixels;
							const band = Math.floor(position / 32);
							const rank = Math.max(0, Math.min(1, band / 3));
							const localProgress = stagger > 0 ? 1 - rank : rank;
							const local = position / 32 - band;
							const inside = mode === 'oneSided' ? local < localProgress : Math.abs(local - 0.5) < localProgress * 0.5;
							if (inside) expected += 1 / samples;
						}
						near(result.mask[16 * 128 + x], expected, 'staggered boundary integration');
					}
				}
			}
		}
		checks.push('staggered neighboring bands and maximum feather');

		// 【Count=1では遅延を無視し、細密な帯では平均を使う】
		// 分母0と、画素より細い帯の位相によるちらつきを検出する。
		const single = await render({ count: 1, stagger: 0, angle: 0.25 }, 'mask');
		for (const stagger of [-1, 1]) equal((await render({ count: 1, stagger, angle: 0.25 }, 'mask')).mask, single.mask, 'single band ignores stagger');
		const dense = await render({ count: 4096, progress: scalar(0.3), angle: 0.25 }, 'mask');
		dense.mask.forEach(value => near(value, 0.3, 'subpixel band average'));
		checks.push('single and subpixel bands');

		// 【回転しても縦横の座標単位が歪まない】
		// 横長と縦長を90度対応させ、投影全幅に対して同じ本数・進行を保つことを確認する。
		const horizontal = await createEffect(64, 32)({ count: 4, angle: 0.25, stagger: 0.4, feather: 0.02 }, 'mask');
		const vertical = await createEffect(32, 64)({ count: 4, angle: 0, stagger: 0.4, feather: 0.02 }, 'mask');
		for (let x = 0; x < 64; x++) near(horizontal.mask[16 * 64 + x], vertical.mask[(63 - x) * 32 + 16], 'aspect independent direction');
		checks.push('aspect independent rotation');

		// 【Size Referenceと解像度の独立性】
		// 距離だけが換算され、Countや角度の意味が変わらないことを確認する。
		const reference = await createEffect(65, 33)({ count: 4, feather: 0.04 * 33 / 65, angle: 0.13 }, 'mask');
		const heightReference = await createEffect(65, 33)({ count: 4, feather: 0.04, sizeReference: 'height', angle: 0.13 }, 'mask');
		equal(reference.mask, heightReference.mask, 'size reference');
		const parameters = { count: 4, feather: 0.08, stagger: -0.6, angle: 0.13, progress: scalar(0.37) };
		const low = await createEffect(33, 17)(parameters, 'mask');
		const high = await createEffect(99, 51)(parameters, 'mask');
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) near(low.mask[y * 33 + x], high.mask[(y * 3 + 1) * 99 + x * 3 + 1], 'resolution independence');
		}
		checks.push('size reference and resolution independence');

		// 【画像・進捗のテクスチャ入力と透明画像の置換】
		// 接続ごとのサンプリングとpipeline切替を通し、定数だけで動く実装を防ぐ。
		const progressValues = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1);
		const colorValues = Array.from({ length: 32 }, (_, index) => [index / 8, -0.25, 0.5, 0.5]).flat();
		const textured = await createEffect(8, 4)({
			inputA: textureInput(8, 4, colorValues),
			inputB: constantShaderInput('color', [3, -5, 2, 0]),
			progress: textureInput(8, 4, progressValues, true),
		});
		progressValues.forEach((progress, index) => {
			near(textured.mask[index], progress, 'texture progress', 0);
			for (let channel = 0; channel < 4; channel++) near(textured.color[index * 4 + channel], progress === 0 ? colorValues[index * 4 + channel] : 0, 'texture and transparent replacement', 0);
		});
		checks.push('texture inputs and transparency');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

