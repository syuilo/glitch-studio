import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/displacementTransition/_def_.ts';
import implementationNative from '../../src/fx/displacementTransition/_impl_.ts';
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
		progress: scalar(0.5), displacement: constantShaderInput('vector', [0.1, 0]), strength: 1, mixWidth: 1,
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

	function textureInput(width: number, height: number, values: number[], kind: 'color' | 'scalar' | 'vector' = 'color') {
		const channels = { color: 4, scalar: 1, vector: 2 }[kind];
		const format = { color: 'rgba16float', scalar: 'r16float', vector: 'rg16float' }[kind] as GPUTextureFormat;
		const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * channels * 2 }, [width, height]);
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
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
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

	const vector = (x: number, y: number) => constantShaderInput('vector', [x, y]);
	const sampleColor = (x: number, y: number, second = false) => second ? [-x / 32, 1 + y / 32, 2, 0.25] : [x / 32, y / 32, -1, 0.5];
	const pattern = (width: number, height: number, second = false) => textureInput(width, height, Array.from({ length: width * height }, (_, index) => sampleColor(index % width, Math.floor(index / width), second)).flat());
	const colorAt = (pixels: Float32Array, width: number, x: number, y: number, expected: number[], label: string) => {
		expected.forEach((value, channel) => near(pixels[(y * width + x) * 4 + channel], value, label));
	};
	try {
		// 【変位が強くても開始と終了は元画像へ連続して戻る】
		// 定数色だけでは歪み残りを検出できないため、画素座標の模様を使う。
		for (const [width, height] of [[33, 17], [17, 33]]) {
			const render = createEffect(width, height);
			const inputA = pattern(width, height);
			const inputB = pattern(width, height, true);
			for (const strength of [-10, 10]) {
				for (const mixWidth of [0, 1]) {
					for (const progress of [-1, 0, 0.000001, 0.999999, 1, 2]) {
						const pixels = await render({ inputA, inputB, displacement: vector(0.3, -0.4), strength, mixWidth, progress: scalar(progress) });
						for (let y = 0; y < height; y++) {
							for (let x = 0; x < width; x++) colorAt(pixels, width, x, y, sampleColor(x, y, progress > 0.5), 'continuous texture endpoint');
						}
					}
				}
			}
			checks.push(`${width}x${height} exact and continuous endpoints`);
		}

		// 【共通単位の同じベクトルが縦長・横長で同じ画素距離を動かす】
		// 1/4・3/4進捗で包絡が9/16になるため、長辺128では変位(1/4,1/8)が
		// (18,9)画素になる。AとBの対向方向と負のStrengthを既知の整数位置で確かめる。
		for (const [width, height] of [[128, 64], [64, 128]]) {
			const render = createEffect(width, height);
			const inputA = pattern(width, height);
			const inputB = pattern(width, height, true);
			const middleX = width / 2;
			const middleY = height / 2;
			for (const strength of [-1, 1]) {
				const before = await render({ inputA, inputB, displacement: vector(0.25, 0.125), strength, mixWidth: 0, progress: scalar(0.25) });
				colorAt(before, width, middleX, middleY, sampleColor(middleX - strength * 18, middleY + strength * 9), 'A common displacement');
				const after = await render({ inputA, inputB, displacement: vector(0.25, 0.125), strength, mixWidth: 0, progress: scalar(0.75) });
				colorAt(after, width, middleX, middleY, sampleColor(middleX + strength * 18, middleY - strength * 9, true), 'B opposite displacement');
			}
			checks.push(`${width}x${height} vector units direction and strength`);
		}

		// 【中央の変位量が指定値そのものになる】
		// Bを透明にしてAのサンプルを独立に測り、逆方向の変位が混合で相殺されるのを避ける。
		const render = createEffect(128, 64);
		const inputA = pattern(128, 64);
		const transparentB = constantShaderInput('color', [8, -4, 1, 0]);
		const maximum = await render({ inputA, inputB: transparentB, displacement: vector(0.125, 0.0625) });
		colorAt(maximum, 128, 64, 32, sampleColor(48, 40).map(value => value * 0.5), 'peak displacement equals input vector');
		checks.push('unit peak envelope');

		// 【RGベクトル場は変形前の出力位置で読む】
		// 出力位置と参照位置が格子の左右をまたぐ例を選び、場を画像と一緒に
		// ずらして読む誤りと、色のように0.5を引く誤りを検出する。
		const displacement = textureInput(128, 64, Array.from({ length: 128 * 64 }, (_, index) => index % 128 < 64 ? [-0.125, 0.0625] : [0.125, -0.0625]).flat(), 'vector');
		const fieldResult = await render({ inputA, inputB: transparentB, displacement });
		colorAt(fieldResult, 128, 56, 32, sampleColor(72, 40).map(value => value * 0.5), 'left vector field sample');
		colorAt(fieldResult, 128, 72, 32, sampleColor(56, 24).map(value => value * 0.5), 'right vector field sample');
		checks.push('vector texture sampled at output coordinates');

		// 【混合期間とHDR・alphaを正しく扱う】
		// 変位を0にすると純粋な混合になり、既知のsmoothstep値と比較できる。
		// 入力のalphaをさらに掛けず、透明なBもAをそのまま減衰させる。
		const constants = createEffect(8, 4);
		for (const [progress, weight] of [[0.25, 0.15625], [0.5, 0.5], [0.75, 0.84375]]) {
			const pixels = await constants({ progress: scalar(progress), strength: 0 });
			pixels.forEach((value, index) => near(value, colorA[index % 4] * (1 - weight) + colorB[index % 4] * weight, 'smooth mixture'));
		}
		for (const [progress, expected] of [[0.499, colorA], [0.5, colorB]] as const) {
			const pixels = await constants({ progress: scalar(progress), mixWidth: 0 });
			pixels.forEach((value, index) => near(value, expected[index % 4], 'zero width cut', 0));
		}
		const transparent = await constants({ inputB: transparentB });
		transparent.forEach((value, index) => near(value, colorA[index % 4] * 0.5, 'transparent mixture'));
		equal(await constants({ mixWidth: -1 }), await constants({ mixWidth: 0 }), 'negative mix width');
		equal(await constants({ mixWidth: 2 }), await constants({ mixWidth: 1 }), 'large mix width');
		checks.push('mix width HDR and alpha');

		// 【変位で画面外へ出たサンプルは接続Wrapに従う】
		// このエフェクト独自の端延長やclampを加えず、透明と反復を区別する。
		const repeated = textureInput(4, 4, Array.from({ length: 16 }, () => colorA).flat());
		if (repeated.kind !== 'texture') throw new Error('Expected texture input');
		const clipped = textureShaderInput(repeated.texture, { filterMode: 'nearest', fitMode: 'stretch', wrapMode: 'transparent' });
		const repeatedResult = await constants({ inputA: repeated, displacement: vector(1, 0), mixWidth: 0, progress: scalar(0.25) });
		const clippedResult = await constants({ inputA: clipped, displacement: vector(1, 0), mixWidth: 0, progress: scalar(0.25) });
		colorAt(repeatedResult, 8, 0, 0, colorA, 'repeat beyond frame');
		colorAt(clippedResult, 8, 0, 0, [0, 0, 0, 0], 'transparent beyond frame');
		checks.push('input wrap preservation');

		// 【局所進捗・再現性・解像度非依存】
		// 進捗場の0/1が正確に元画像を選び、非端点では同じ座標が解像度や時刻で変わらない。
		const localProgress = textureInput(8, 4, Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1), 'scalar');
		const local = await constants({ progress: localProgress, displacement: vector(0.4, -0.2) });
		local.forEach((value, index) => near(value, (Math.floor(index / 4) % 8 < 4 ? colorA : colorB)[index % 4], 'local progress endpoints', 0));
		const source = pattern(33, 17);
		const parameters = { inputA: source, inputB: transparentB, progress: scalar(0.37), displacement: vector(0.13, -0.07), strength: 0.7 };
		const lowRender = createEffect(33, 17);
		const low = await lowRender(parameters);
		equal(await lowRender(parameters, 100), low, 'time independent');
		const high = await createEffect(99, 51)(parameters);
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) {
				for (let channel = 0; channel < 4; channel++) near(low[(y * 33 + x) * 4 + channel], high[((y * 3 + 1) * 99 + x * 3 + 1) * 4 + channel], 'resolution independent');
			}
		}
		checks.push('local progress determinism and resolution');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

