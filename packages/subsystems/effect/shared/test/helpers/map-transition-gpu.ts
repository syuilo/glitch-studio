import definition from '../../src/fx/mapTransition/_def_.ts';
import implementation from '../../src/fx/mapTransition/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

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

	const fallback = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
	disposables.push(() => fallback.destroy());

	function createEffect(width = 8, height = 4, precise = true) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const defaults: Parameters = {
			inputA, inputB, progress: scalar(0.5), map: scalar(0.5), softness: 0.1, reverse: false, antiAlias: true,
		};
		const textures = new Map<string, GPUTexture>();
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: fallback, reportStatus: () => {} });
		disposables.push(() => { instance.dispose(); for (const texture of textures.values()) texture.destroy(); });
		return async (overrides: Partial<Parameters> = {}, mode: 'color' | 'mask' | 'both' = 'both', time = 0) => {
			const keys: ('output' | 'mask')[] = mode === 'both' ? ['output', 'mask'] : [mode === 'color' ? 'output' : 'mask'];
			const outputDataMap = Object.fromEntries(keys.map(key => {
				let texture = textures.get(key);
				if (texture == null) {
					texture = implementation.outputTextureFactories[key]({ wgpu, resolution });
					textures.set(key, texture);
				}
				if (key === 'mask') assert(texture.format === (precise ? 'r32float' : 'r16float'), 'mask precision');
				return [key, { texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null }];
			}));
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 }, outputDataMap,
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
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
		for (const precise of [false, true]) {
			const render = createEffect(8, 4, precise);
			// 【進捗の両端はMapやSoftnessによらず入力そのもの】
			// 反転・範囲外Map・大きな幅で端点に残像が残ることを防ぐ。
			for (const reverse of [false, true]) {
				for (const mapValue of [-2, 0.5, 3]) {
					for (const softness of [0, 0.5, 100000]) {
						for (const progress of [-1, 0, 1, 2]) {
							const result = await render({ map: scalar(mapValue), progress: scalar(progress), softness, reverse });
							const endpoint = progress <= 0 ? 0 : 1;
							assert(result.mask.every(value => value === endpoint), 'exact endpoint mask');
							result.color.forEach((value, index) => near(value, (endpoint === 0 ? colorA : colorB)[index % 4], 'exact endpoint color', 0));
						}
					}
				}
			}
			checks.push(`${precise ? 32 : 16}bit exact endpoints`);

			// 【Softnessが正ならMapの0/1も連続的にA/Bへつながる】
			// 幅を画面外まで動かさず端点だけ強制する実装ではこの極限が不連続になる。
			for (const mapValue of [0, 1]) {
				for (const softness of [0.1, 1, 100000]) {
					const start = await render({ map: scalar(mapValue), softness, progress: scalar(0.00001) }, 'mask');
					const end = await render({ map: scalar(mapValue), softness, progress: scalar(0.99999) }, 'mask');
					assert(start.mask.every(value => value < 0.00001) && end.mask.every(value => value > 0.9999), 'continuous soft endpoints');
				}
			}
			checks.push(`${precise ? 32 : 16}bit continuous soft endpoints`);

			// 【Mapの数値を混合率ではなく切替順として読む】
			// 既知のsmoothstep値を持つ区間を使い、幅の半幅/全幅の取り違えも検出する。
			const mapValues = [-2, 0, 0.25, 0.375, 0.5, 0.625, 1, 2];
			const map = textureInput(8, 1, mapValues, true);
			const expected = [1, 1, 1, 0.84375, 0.5, 0.15625, 0, 0];
			const baseline = await render({ map, softness: 0.5, antiAlias: false });
			baseline.mask.forEach((mask, index) => {
				near(mask, expected[index % 8], 'map order and clamping');
				for (let channel = 0; channel < 4; channel++) near(baseline.color[index * 4 + channel], colorA[channel] * (1 - mask) + colorB[channel] * mask, 'HDR premultiplied mix');
			});
			const reversed = await render({ map, softness: 0.5, antiAlias: false, reverse: true }, 'mask');
			baseline.mask.forEach((mask, index) => near(reversed.mask[index], 1 - mask, 'reverse order'));
			checks.push(`${precise ? 32 : 16}bit map order width and reverse`);

			// 【画像単独・Mask単独・両方で同じ重みを使う】
			// 未確保の画像出力を参照せず、時刻や描画順にも依存しないことを確認する。
			equal((await render({ map, softness: 0.5, antiAlias: false }, 'color')).color, baseline.color, 'color only');
			equal((await render({ map, softness: 0.5, antiAlias: false }, 'mask', 123)).mask, baseline.mask, 'deterministic mask only');
			const maskOnly = createEffect(8, 4, precise);
			equal((await maskOnly({ map, softness: 0.5, antiAlias: false }, 'mask')).mask, baseline.mask, 'mask without color target');
			const transparent = await render({ map, softness: 0.5, antiAlias: false, inputB: constantShaderInput('color', [8, -3, 2, 0]) });
			transparent.mask.forEach((mask, index) => {
				for (let channel = 0; channel < 4; channel++) near(transparent.color[index * 4 + channel], colorA[channel] * (1 - mask), 'transparent input');
			});
			checks.push(`${precise ? 32 : 16}bit lazy outputs alpha and reproducibility`);
		}

		const render = createEffect();
		// 【ゼロSoftnessの定数Mapは閾値で一斉に切り替わる】
		// 硬い切替と滑らかな切替を意図的に区別し、隠れた最小フェード幅を作らない。
		for (const [progress, expected] of [[0.49, 0], [0.5, 1], [0.51, 1]]) {
			const result = await render({ map: scalar(0.5), progress: scalar(progress), softness: 0 }, 'mask');
			assert(result.mask.every(value => value === expected), 'hard constant threshold');
		}
		checks.push('hard threshold at zero softness');

		// 【AAは連続Mapの輪郭を滑らかにし、無効時は離散切替を保つ】
		// fwidthの評価位置や非一様分岐によりAAが消えるケースを検出する。
		const ramp = textureInput(8, 1, Array.from({ length: 8 }, (_, index) => index / 8), true);
		const aa = await render({ map: ramp, softness: 0, progress: scalar(0.4) }, 'mask');
		const hard = await render({ map: ramp, softness: 0, progress: scalar(0.4), antiAlias: false }, 'mask');
		assert(aa.mask.some(value => value > 0 && value < 1), 'anti-aliased boundary');
		assert(hard.mask.every(value => value === 0 || value === 1), 'disabled antialias');
		near(aa.mask[3], 0.648, 'antialias map-value width');
		const progressAa = await render({ map: scalar(0.4), progress: ramp, softness: 0 }, 'mask');
		const progressHard = await render({ map: scalar(0.4), progress: ramp, softness: 0, antiAlias: false }, 'mask');
		assert(progressAa.mask.some(value => value > 0 && value < 1), 'antialias spatial progress');
		assert(progressHard.mask.every(value => value === 0 || value === 1), 'hard spatial progress');
		near(progressAa.mask[3], 0.08115625, 'antialias progress-value width');
		checks.push('optional antialias');

		// 【進捗・画像もテクスチャで受け取る】
		// 同じshaderが定数とテクスチャを正しく切り替え、RGBAを再乗算しないことを確認する。
		const progressValues = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1);
		const colorValues = Array.from({ length: 32 }, (_, index) => [index / 8, -0.25, 0.5, 0.5]).flat();
		const result = await render({
			inputA: textureInput(8, 4, colorValues),
			inputB: textureInput(1, 1, colorB),
			map: ramp,
			progress: textureInput(8, 4, progressValues, true),
		});
		progressValues.forEach((progress, index) => {
			near(result.mask[index], progress, 'texture progress endpoint', 0);
			for (let channel = 0; channel < 4; channel++) near(result.color[index * 4 + channel], progress === 0 ? colorValues[index * 4 + channel] : colorB[channel], 'texture image endpoint', 0);
		});
		checks.push('image and progress texture inputs');

		// 【一様な進捗を増やすと全ての画素で単調にBが増える】
		// reverseは順序を変えてもA→Bを逆転させず、時刻による揺らぎも作らない。
		for (const reverse of [false, true]) {
			let previous = new Float32Array(32);
			for (const progress of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
				const current = await render({ map: ramp, progress: scalar(progress), reverse, softness: 0.4 }, 'mask');
				assert(current.mask.every((value, index) => value >= previous[index]), 'monotone progress');
				previous = current.mask;
			}
		}
		checks.push('monotone progress in both orders');

		// 【Mapの内容が同じなら解像度・縦横比で切替率を変えない】
		// scalar値は画像座標とは独立で、寸法に応じた誤った正規化を行わない。
		for (const [width, height] of [[17, 9], [9, 17], [51, 27]]) {
			const values = await createEffect(width, height)({ map: scalar(0.375), softness: 0.5 }, 'mask');
			assert(values.mask.every(value => Math.abs(value - 0.84375) < 0.0001), 'resolution independent scalar map');
		}
		checks.push('resolution and aspect ratio independence');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
