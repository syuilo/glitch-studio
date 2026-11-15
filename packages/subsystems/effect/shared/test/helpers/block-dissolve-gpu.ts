import definition from '../../src/fx/blockDissolve/_def_.ts';
import implementation from '../../src/fx/blockDissolve/_impl_.ts';
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
			inputA, inputB, progress: scalar(0.5), cellSize: 0.125, gridOffset: [0, 0], sizeReference: 'longSide', order: 'random', seed: 0, softness: 0.1, reverse: false,
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
			const render = createEffect(32, 16, precise);
			// 【端点は順序・反転・幅によらず完全な入力になる】
			// セルの時間幅を大きくしても残像を残さず、硬い切替も同じ端点規約を持つ。
			for (const order of ['random', 'leftToRight', 'topToBottom'] as const) {
				for (const reverse of [false, true]) {
					for (const softness of [0, 0.5, 100]) {
						for (const progress of [-1, 0, 1, 2]) {
							const result = await render({ order, reverse, softness, progress: scalar(progress) });
							const endpoint = progress <= 0 ? 0 : 1;
							assert(result.mask.every(value => value === endpoint), 'exact endpoint mask');
							result.color.forEach((value, index) => near(value, (endpoint === 0 ? colorA : colorB)[index % 4], 'exact endpoint color', 0));
						}
					}
				}
			}
			const nearStart = await render({ progress: scalar(0.00001), softness: 100 }, 'mask');
			const nearEnd = await render({ progress: scalar(0.99999), softness: 100 }, 'mask');
			assert(nearStart.mask.every(value => value < 0.00001) && nearEnd.mask.every(value => value > 0.9999), 'continuous soft endpoints');
			checks.push(`${precise ? 32 : 16}bit exact and continuous endpoints`);

			// 【画像とMaskは同じ混合率を使う】HDR・負値・異なるalphaを使い、
			// 二重乗算・入力clamp・透明なBの下にAを残すsource-overを検出する。
			const baseline = await render({ softness: 0.6 });
			baseline.mask.forEach((mask, index) => {
				for (let channel = 0; channel < 4; channel++) near(baseline.color[index * 4 + channel], colorA[channel] * (1 - mask) + colorB[channel] * mask, 'HDR premultiplied mixture');
			});
			const transparent = await render({ softness: 0.6, inputB: constantShaderInput('color', [8, -3, 2, 0]) });
			transparent.mask.forEach((mask, index) => {
				for (let channel = 0; channel < 4; channel++) near(transparent.color[index * 4 + channel], colorA[channel] * (1 - mask), 'transparent replacement');
			});
			equal((await render({ softness: 0.6 }, 'color')).color, baseline.color, 'image only');
			equal((await render({ softness: 0.6 }, 'mask', 123)).mask, baseline.mask, 'time independent mask');
			const maskOnly = createEffect(32, 16, precise);
			equal((await maskOnly({ softness: 0.6 }, 'mask')).mask, baseline.mask, 'mask without image allocation');
			checks.push(`${precise ? 32 : 16}bit HDR alpha lazy output and time independence`);
		}

		const render = createEffect(64, 32);
		// 【列・行の順序と時間幅を既知の値で確認する】
		// 表示範囲には5列、3行のセルがあり、同じ列/行は同じ時刻に切り替わる。
		const horizontal = await render({ order: 'leftToRight', cellSize: 0.25, softness: 0.5 }, 'mask');
		for (const [x, expected] of [[4, 1], [16, 0.972], [32, 0.5], [48, 0.028], [60, 0]]) {
			for (const y of [0, 15, 31]) near(horizontal.mask[y * 64 + x], expected, 'column timing');
		}
		const vertical = await render({ order: 'topToBottom', cellSize: 0.25, softness: 0.5 }, 'mask');
		for (const [y, expected] of [[3, 1], [16, 0.5], [28, 0]]) {
			for (const x of [0, 31, 63]) near(vertical.mask[y * 64 + x], expected, 'row timing');
		}
		const hard = await render({ order: 'leftToRight', cellSize: 0.25, softness: 0 }, 'mask');
		assert(hard.mask.every(value => value === 0 || value === 1), 'hard cell switch');
		checks.push('directional order and temporal softness');

		// 【逆順は入力を逆転せず、全順序で同じセルの切替時刻を反転する】
		// 中点では正順・逆順の混合率の和が1になる。
		for (const order of ['random', 'leftToRight', 'topToBottom'] as const) {
			const forward = await render({ order, softness: 0.5 }, 'mask');
			const backward = await render({ order, softness: 0.5, reverse: true }, 'mask');
			forward.mask.forEach((value, index) => near(value + backward.mask[index], 1, 'reverse order complement'));
			let previous = new Float32Array(64 * 32);
			for (const progress of [0.05, 0.25, 0.6, 0.9]) {
				const result = await render({ order, progress: scalar(progress), softness: 0.5 }, 'mask');
				assert(result.mask.every((value, index) => value >= previous[index]), 'monotone progress');
				previous = result.mask;
			}
		}
		checks.push('reverse and monotone order');

		// 【ランダム順序は同じセル内で一定、Seed変更だけで再配置する】
		// 画素単位の乱数や時刻を混ぜる実装を排除する。
		const random = await render({ seed: 15, softness: 0.5 }, 'mask');
		const otherSeed = await render({ seed: 16, softness: 0.5 }, 'mask');
		assert(random.mask.some((value, index) => Math.abs(value - otherSeed.mask[index]) > 0.1), 'seed changes pattern');
		for (const centerX of [8, 16, 24, 32, 40, 48, 56]) {
			for (const centerY of [8, 16, 24]) {
				const centerValue = random.mask[centerY * 64 + centerX];
				for (let y = centerY - 3; y <= centerY + 2; y++) {
					for (let x = centerX - 3; x <= centerX + 2; x++) near(random.mask[y * 64 + x], centerValue, 'constant square cell', 0);
				}
			}
		}
		checks.push('deterministic square cell hashing');

		// 【格子を共通座標で移動できる】同じSeedの模様を4画素だけ平行移動して、
		// Offsetがセル寸法や画面UV単位で解釈される誤りを検出する。
		const shifted = await render({ seed: 15, softness: 0.5, gridOffset: [0.0625, 0] }, 'mask');
		for (let y = 0; y < 32; y++) {
			for (let x = 4; x < 64; x++) near(shifted.mask[y * 64 + x], random.mask[y * 64 + x - 4], 'common grid offset', 0);
		}
		const heightReference = await render({ seed: 15, softness: 0.5, cellSize: 0.25, sizeReference: 'height' }, 'mask');
		equal(heightReference.mask, random.mask, 'reference scales cell size only');
		checks.push('grid offset and size reference');

		// 【同じ共通座標のセルは解像度・縦横比によらず同じ値になる】
		// 同じ比率の3倍解像度、および横長/縦長の共通領域を比較する。
		const parameters: Partial<Parameters> = { cellSize: 0.17, softness: 0.5, seed: 23 };
		const low = await createEffect(33, 17)(parameters, 'mask');
		const high = await createEffect(99, 51)(parameters, 'mask');
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) near(low.mask[y * 33 + x], high.mask[(y * 3 + 1) * 99 + x * 3 + 1], 'resolution independence', 0);
		}
		const tall = await createEffect(17, 33)(parameters, 'mask');
		for (let y = -8; y <= 8; y++) {
			for (let x = -8; x <= 8; x++) near(low.mask[(8 - y) * 33 + 16 + x], tall.mask[(16 - y) * 17 + 8 + x], 'isotropic aspect independence', 0);
		}
		checks.push('resolution and aspect independence');

		// 【画像・進捗のテクスチャ入力】セル順序に関係なく画素ごとの0/1でA/Bを選べる。
		// ShaderInput構成の切替と入力色の再乗算がないことも同時に確認する。
		const renderTextures = createEffect(8, 4);
		const progressValues = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1);
		const colorValues = Array.from({ length: 32 }, (_, index) => [index / 8, -0.25, 0.5, 0.5]).flat();
		const textureResult = await renderTextures({
			inputA: textureInput(8, 4, colorValues),
			inputB: textureInput(1, 1, colorB),
			progress: textureInput(8, 4, progressValues, true),
		});
		progressValues.forEach((progress, index) => {
			near(textureResult.mask[index], progress, 'texture progress', 0);
			for (let channel = 0; channel < 4; channel++) near(textureResult.color[index * 4 + channel], progress === 0 ? colorValues[index * 4 + channel] : colorB[channel], 'texture color', 0);
		});
		checks.push('image and progress texture inputs');

		// 【極小・巨大セルも有限値を返す】最小サイズや画面全体を覆うセルで、
		// 0除算・空のセル数・範囲外Maskを生じないことを確認する。
		for (const cellSize of [0, -1, 100]) {
			for (const order of ['random', 'leftToRight', 'topToBottom'] as const) await render({ cellSize, order, gridOffset: [0.37, -0.4] }, 'mask');
		}
		checks.push('degenerate cell sizes');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

