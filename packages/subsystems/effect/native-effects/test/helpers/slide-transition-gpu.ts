import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/slideTransition/_def_.ts';
import implementationNative from '../../src/fx/slideTransition/_impl_.ts';
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
	const near = (actual: number, expected: number, label: string, tolerance = 0.003) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => {
		assert(actual.length === expected.length, label);
		actual.forEach((value, index) => near(value, expected[index], label));
	};
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const colorA = [2, -1, 0.5, 0.5];
	const colorB = [-0.5, 1, 0, 0.25];
	const defaults: Parameters = {
		inputA: constantShaderInput('color', [4, -2, 1, 0.5]),
		inputB: constantShaderInput('color', [-2, 4, 0, 0.25]),
		progress: scalar(0.5), angle: 0, mode: 'cover',
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

	function textureInput(width: number, height: number, values: number[], scalarTexture = false) {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode: 'nearest', fitMode: 'stretch', wrapMode: 'repeat' });
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
				pointerPosition: { x: 0, y: 0 },
				outputs: { output },
			});
			device.queue.submit([encoder.finish()]);
			const pixels = await read(output);
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'finite output');
			return pixels;
		};
	}

	try {
		// 【HDR・半透明の端点と連続性】source-overで背景が残ったり、
		// 端点直前だけ違う結果になることを、透明度の異なる入力で検出する。
		for (const mode of ['cover', 'uncover'] as const) {
			for (const [width, height] of [[33, 17], [17, 33]]) {
				const render = createEffect(width, height);
				for (const angle of [0, 0.125, 0.25, 0.625]) {
					for (const progress of [-1, 0, 1, 2]) {
						const pixels = await render({ mode, angle, progress: scalar(progress) });
						pixels.forEach((value, index) => near(value, (progress <= 0 ? colorA : colorB)[index % 4], 'exact endpoint', 0));
					}
					for (const progress of [0.000001, 0.999999]) {
						const pixels = await render({ mode, angle, progress: scalar(progress) });
						pixels.forEach((value, index) => near(value, (progress < 0.5 ? colorA : colorB)[index % 4], 'continuous endpoint'));
					}
				}
			}
			checks.push(`${mode} endpoints with HDR alpha and aspect ratios`);
		}

		// 【四方向・斜めの矩形移動】既知の画素番号を色として読み戻し、
		// 静止画像を動かす誤り、元画像内の参照座標の符号違い、Repeatの漏出を検出する。
		for (const [width, height] of [[8, 4], [4, 8]]) {
			const valuesA = Array.from({ length: width * height }, (_, index) => [10 + index % width, Math.floor(index / width), -2, 0.5]).flat();
			const valuesB = Array.from({ length: width * height }, (_, index) => [-10 - index % width, 4 + Math.floor(index / width), 2, 0.25]).flat();
			const inputA = textureInput(width, height, valuesA);
			const inputB = textureInput(width, height, valuesB);
			const render = createEffect(width, height);
			const diagonalOffset = Math.min(width, height) / 2;
			for (const [angle, offsetX, offsetY] of [[0, 0, height / 2], [0.25, width / 2, 0], [0.5, 0, -height / 2], [0.75, -width / 2, 0], [0.125, diagonalOffset, diagonalOffset]]) {
				for (const mode of ['cover', 'uncover'] as const) {
					const pixels = await render({ mode, angle, inputA, inputB });
					const sign = mode === 'cover' ? -1 : 1;
					for (let y = 0; y < height; y++) {
						for (let x = 0; x < width; x++) {
							const sourceX = x - sign * offsetX;
							const sourceY = y + sign * offsetY;
							const moving = sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height;
							const values = moving === (mode === 'cover') ? valuesB : valuesA;
							const sourceIndex = moving ? sourceY * width + sourceX : y * width + x;
							for (let channel = 0; channel < 4; channel++) near(pixels[(y * width + x) * 4 + channel], values[sourceIndex * 4 + channel], 'translated texture sample');
						}
					}
				}
			}
			checks.push(`${width}x${height} cardinal diagonal texture clipping`);
		}

		// 【半画素の境界と完全透明の置換】Bのalphaを合成係数にしないことを確認し、
		// 矩形の端のAAと半透明色の二重乗算を検出する。
		const render = createEffect(8, 4);
		const antialias = await render({ angle: 0.25, progress: scalar(3.5 / 8) });
		for (let channel = 0; channel < 4; channel++) near(antialias[(1 * 8 + 3) * 4 + channel], (colorA[channel] + colorB[channel]) / 2, 'half pixel antialias');
		const transparent = await render({ angle: 0.25, inputB: constantShaderInput('color', [5, -4, 3, 0]) });
		for (let channel = 0; channel < 4; channel++) near(transparent[channel], 0, 'transparent B replaces A', 0);
		checks.push('fractional boundary and transparent replacement');

		// 【進捗のテクスチャと時間非依存】同じShaderInput基盤で画素ごとの0/1を扱い、
		// 未接続・定数入力からテクスチャ入力へのpipeline切替も通す。
		const progressValues = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1);
		const progress = textureInput(8, 4, progressValues, true);
		const local = await render({ progress });
		local.forEach((value, index) => near(value, (progressValues[Math.floor(index / 4)] === 0 ? colorA : colorB)[index % 4], 'spatial progress'));
		equal(await render({ progress }, 100), local, 'time independent');
		checks.push('texture progress and deterministic rendering');

		// 【同じ比率で画素数を増やしても移動が一致する】
		// 3倍解像度で同じ画素中心を比較し、フレームの長さに画素依存が混ざることを防ぐ。
		for (const mode of ['cover', 'uncover'] as const) {
			const parameters = { mode, angle: 0.125, progress: scalar(0.5) };
			const low = await createEffect(9, 5)(parameters);
			const high = await createEffect(27, 15)(parameters);
			for (const [x, y] of [[1, 1], [7, 1], [1, 3], [7, 3]]) {
				for (let channel = 0; channel < 4; channel++) near(low[(y * 9 + x) * 4 + channel], high[((y * 3 + 1) * 27 + x * 3 + 1) * 4 + channel], 'resolution independent');
			}
		}
		checks.push('resolution independent geometry');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

