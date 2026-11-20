import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/pushTransition/_def_.ts';
import implementationNative from '../../src/fx/pushTransition/_impl_.ts';
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
		progress: scalar(0.5), angle: 0,
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

	const colorAt = (pixels: Float32Array, width: number, x: number, y: number, expected: number[], name: string) => {
		expected.forEach((value, channel) => near(pixels[(y * width + x) * 4 + channel], value, name));
	};
	const patternColor = (x: number, y: number, second: boolean) => second ? [-(x + 1) / 16, (y + 1) / 16, 0.25, 1] : [(x + 1) / 16, -(y + 1) / 16, 0.125, 1];
	const pattern = (width: number, height: number, second: boolean, filterMode: 'linear' | 'nearest' = 'nearest') => field(width, height, Array.from({ length: width * height }, (_, index) => patternColor(index % width, Math.floor(index / width), second)).flat(), false, filterMode);
	try {
		// 【進捗の端点は入力をそのまま返す】HDR・負値・半透明の値を明示し、
		// 色のclampやalphaの二重乗算、端点での参照位置変更を検出する。
		const render = createEffect(65, 33);
		for (const angle of [0, 0.125, 0.25, -0.375, 1.125]) {
			for (const progress of [-1, 0, 1, 2]) {
				const pixels = await render({ angle, progress: scalar(progress) });
				const expected = progress <= 0 ? colorA : colorB;
				pixels.forEach((value, index) => near(value, expected[index % 4], 'exact color endpoints', 0));
			}
		}
		checks.push('exact HDR alpha endpoints');

		// 【上下左右で画像の内容も平行移動する】定数色だけではWipeと区別できない。
		// 既知の座標勾配を使い、AもBも移動することと移動量を確認する。
		const cardinal = createEffect(64, 32);
		const inputA = pattern(64, 32, false);
		const inputB = pattern(64, 32, true);
		const upward = await cardinal({ inputA, inputB, progress: scalar(0.25) });
		colorAt(upward, 64, 32, 4, patternColor(32, 12, false), 'upward A moved eight pixels');
		colorAt(upward, 64, 32, 28, patternColor(32, 4, true), 'upward B enters from below');
		const rightward = await cardinal({ inputA, inputB, progress: scalar(0.25), angle: 0.25 });
		colorAt(rightward, 64, 40, 16, patternColor(24, 16, false), 'rightward A moved sixteen pixels');
		colorAt(rightward, 64, 8, 16, patternColor(56, 16, true), 'rightward B enters from left');
		const downward = await cardinal({ inputA, inputB, progress: scalar(0.25), angle: 0.5 });
		colorAt(downward, 64, 32, 20, patternColor(32, 12, false), 'downward A');
		colorAt(downward, 64, 32, 4, patternColor(32, 28, true), 'downward B');
		const leftward = await cardinal({ inputA, inputB, progress: scalar(0.25), angle: 0.75 });
		colorAt(leftward, 64, 24, 16, patternColor(40, 16, false), 'leftward A');
		colorAt(leftward, 64, 56, 16, patternColor(8, 16, true), 'leftward B');
		checks.push('four cardinal translations');

		// 【斜めの空隙は端画素で埋める】Repeat入力でも反対側の画素を読み出さず、
		// 2枚の矩形が覆えない隅を透明にしないという選択済みの仕様を確認する。
		const square = createEffect(32, 32);
		const diagonal = await square({ inputA: pattern(32, 32, false), inputB: pattern(32, 32, true), angle: 0.125 });
		colorAt(diagonal, 32, 4, 2, patternColor(0, 18, false), 'diagonal extended A left edge');
		colorAt(diagonal, 32, 2, 4, patternColor(18, 0, true), 'diagonal extended B top edge');
		colorAt(diagonal, 32, 28, 3, patternColor(12, 19, false), 'diagonal A interior');
		colorAt(diagonal, 32, 3, 28, patternColor(19, 12, true), 'diagonal B interior');
		for (let index = 3; index < diagonal.length; index += 4) near(diagonal[index], 1, 'no diagonal holes', 0);
		checks.push('diagonal edge extension without wrapping');

		// 【長方形でも45度は等しいXY距離を移動する】各軸[-1,+1]で方向を計算すると、
		// 横長のXだけが倍速になる。実画素で同じ24pxの移動を確認する。
		const rectangularDiagonal = await cardinal({ inputA, inputB, angle: 0.125 });
		colorAt(rectangularDiagonal, 64, 50, 4, patternColor(26, 28, false), 'rectangular equal XY translation');
		colorAt(rectangularDiagonal, 64, 12, 4, patternColor(36, 0, true), 'rectangular extended edge');
		const portrait = createEffect(32, 64);
		const portraitDiagonal = await portrait({ inputA: pattern(32, 64, false), inputB: pattern(32, 64, true), angle: 0.125 });
		colorAt(portraitDiagonal, 32, 28, 12, patternColor(4, 36, false), 'portrait equal XY translation');
		checks.push('aspect-independent direction');

		// 【AA境界と透明なBの置換】半透明同士をsource-overで重ねずRGBA全体を補間する。
		// 完全にBへ置き換わった領域は、Bが透明なら完全に透明になる。
		const midpoint = await render();
		colorAt(midpoint, 65, 32, 16, colorA.map((value, channel) => (value + colorB[channel]) * 0.5), 'boundary antialias');
		const transparent = await render({ inputB: constantShaderInput('color', [9, -4, 3, 0]) });
		colorAt(transparent, 65, 32, 30, [0, 0, 0, 0], 'transparent B replaces A');
		colorAt(transparent, 65, 32, 16, colorA.map(value => value * 0.5), 'transparent boundary');
		checks.push('premultiplied antialias and transparency');

		// 【進捗場は出力位置で評価する】局所進捗0/1が幾何に影響されずA/Bを選ぶ。
		// 画像と一緒に進捗場を移動する誤りやuniform専用実装を検出する。
		const localProgress = field(8, 4, Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1), true);
		const localPixels = await createEffect(8, 4)({ progress: localProgress, angle: 0.125 });
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 8; x++) colorAt(localPixels, 8, x, y, x < 4 ? colorA : colorB, 'local progress endpoints');
		}
		checks.push('texture-driven local progress');

		// 【端点への連続性・角度の周期・時刻非依存】線形フィルタの画像で端点直前を比較し、
		// 最後だけ元画像へ飛ぶ補正や、時刻を使った移動を検出する。
		const smoothA = pattern(64, 32, false, 'linear');
		const smoothB = pattern(64, 32, true, 'linear');
		for (const endpoint of [0, 1]) {
			const exact = await cardinal({ inputA: smoothA, inputB: smoothB, angle: 0.125, progress: scalar(endpoint) });
			const close = await cardinal({ inputA: smoothA, inputB: smoothB, angle: 0.125, progress: scalar(endpoint === 0 ? 0.00001 : 0.99999) });
			// HDR値4付近のhalf-float丸めとGPUの線形フィルタ精度を許容する。
			exact.forEach((value, index) => near(close[index], value, 'continuous endpoint', 0.005));
		}
		const baseline = await cardinal({ inputA, inputB, angle: 0.125 });
		const repeated = await cardinal({ inputA, inputB, angle: 1.125 }, 100);
		baseline.forEach((value, index) => near(repeated[index], value, 'angle and time invariance', 0));
		checks.push('continuous deterministic endpoints');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

