import definition from '../../src/fx/zoomTransition/_def_.ts';
import implementation from '../../src/fx/zoomTransition/_impl_.ts';
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
		progress: scalar(0.5), center: [0, 0], zoom: 2, direction: 'in', overlap: 0.5,
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
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		disposables.push(() => { instance.dispose(); output.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
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
		// 【端点とその直前で元画像へ連続してつながる】
		// 端点だけ元画像を返してズーム倍率が飛ぶ実装を、複数倍率・方向で検出する。
		for (const direction of ['in', 'out'] as const) {
			for (const [width, height] of [[33, 17], [17, 33]]) {
				const render = createEffect(width, height);
				const valuesA = Array.from({ length: width * height }, (_, index) => [index % width / 8, Math.floor(index / width) / 8, -1, 0.5]).flat();
				const valuesB = Array.from({ length: width * height }, (_, index) => [-index % width / 8, 1 + Math.floor(index / width) / 8, 2, 0.25]).flat();
				const inputA = textureInput(width, height, valuesA);
				const inputB = textureInput(width, height, valuesB);
				for (const zoom of [1, 16]) {
					for (const overlap of [0, 1]) {
						for (const progress of [-1, 0, 0.000001, 0.999999, 1, 2]) {
							const pixels = await render({ direction, zoom, overlap, inputA, inputB, center: [0.12, -0.2], progress: scalar(progress) });
							equal(pixels, new Float32Array(progress < 0.5 ? valuesA : valuesB), 'continuous texture endpoint');
						}
					}
				}
			}
			checks.push(`${direction} continuous texture endpoints`);
		}

		// 【拡大縮小の倍率と共通座標の中心が一致する】
		// Zoom=16の1/4進捗は2倍。画素番号で作った画像の既知の参照点を読み、
		// 逆参照の符号・縦横比・中心の換算を独立した整数位置と照合する。
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const render = createEffect(width, height);
			const valuesA = Array.from({ length: width * height }, (_, index) => [index % width, Math.floor(index / width), -1, 0.5]).flat();
			const valuesB = Array.from({ length: width * height }, (_, index) => [-100 - index % width, 100 + Math.floor(index / width), 2, 0.25]).flat();
			const inputA = textureInput(width, height, valuesA);
			const inputB = textureInput(width, height, valuesB);
			const longest = Math.max(width, height);
			const center = [4 / longest, -2 / longest] as const;
			const middleX = (width - 1) / 2;
			const middleY = (height - 1) / 2;
			for (const [direction, progress, sourceX, sourceY] of [
				['in', 0.25, 6, 1], ['in', 0.75, 12, 10],
				['out', 0.25, 12, 10], ['out', 0.75, 6, 1],
			] as const) {
				const pixels = await render({ direction, progress: scalar(progress), zoom: 16, inputA, inputB, center });
				const values = progress < 0.5 ? valuesA : valuesB;
				const expectedIndex = (middleY - sourceY) * width + middleX + sourceX;
				const outputIndex = (middleY - 4) * width + middleX + 8;
				for (let channel = 0; channel < 4; channel++) near(pixels[outputIndex * 4 + channel], values[expectedIndex * 4 + channel], 'known zoom sample');
			}
			checks.push(`${width}x${height} isotropic zoom and center`);
		}

		// 【Overlapの全幅と透明度を含む混合】
		// 進捗1/4・3/4のsmoothstep値を既知の定数と照合し、alphaを混合係数に
		// 使う誤りや、HDR・負値のclampを検出する。Zoom=1は純粋な切替になる。
		const render = createEffect(8, 4);
		for (const [progress, weight] of [[0.25, 0.15625], [0.5, 0.5], [0.75, 0.84375]]) {
			const pixels = await render({ progress: scalar(progress), overlap: 1, zoom: 1 });
			pixels.forEach((value, index) => near(value, colorA[index % 4] * (1 - weight) + colorB[index % 4] * weight, 'overlap smooth mix'));
		}
		for (const [progress, expected] of [[0.499, colorA], [0.5, colorB]] as const) {
			const pixels = await render({ progress: scalar(progress), overlap: 0 });
			pixels.forEach((value, index) => near(value, expected[index % 4], 'zero overlap cut', 0));
		}
		const transparent = await render({ inputB: constantShaderInput('color', [5, -4, 3, 0]) });
		transparent.forEach((value, index) => near(value, colorA[index % 4] * 0.5, 'transparent replacement'));
		equal(await render({ overlap: -1 }), await render({ overlap: 0 }), 'negative overlap clamp');
		equal(await render({ overlap: 2 }), await render({ overlap: 1 }), 'large overlap clamp');
		equal(await render({ zoom: 0 }), await render({ zoom: 1 }), 'minimum zoom factor');
		checks.push('overlap alpha HDR and parameter bounds');

		// 【縮小時の範囲外は入力Wrapに従う】
		// Pushの端延長やSlideの矩形切抜きを持ち込まず、RepeatとTransparentを
		// 同じ変形へ適用したときにそれぞれのサンプリング規約を維持する。
		const repeated = textureInput(4, 4, Array.from({ length: 16 }, () => colorA).flat());
		if (repeated.kind !== 'texture') throw new Error('Expected a texture input');
		const emptyOutside = textureShaderInput(repeated.texture, { filterMode: 'nearest', fitMode: 'stretch', wrapMode: 'transparent' });
		const repeatedPixels = await render({ inputA: repeated, direction: 'out', zoom: 16, progress: scalar(0.25) });
		const clippedPixels = await render({ inputA: emptyOutside, direction: 'out', zoom: 16, progress: scalar(0.25) });
		for (let channel = 0; channel < 4; channel++) {
			near(repeatedPixels[channel], colorA[channel], 'repeat outside');
			near(clippedPixels[channel], 0, 'transparent outside', 0);
		}
		checks.push('input wrap preservation');

		// 【進捗のテクスチャと時間非依存】
		// 出力位置の進捗を参照し、局所進捗を変形後の座標で読み直さないことを確認する。
		const progressValues = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1);
		const progress = textureInput(8, 4, progressValues, true);
		const local = await render({ progress });
		local.forEach((value, index) => near(value, (progressValues[Math.floor(index / 4)] === 0 ? colorA : colorB)[index % 4], 'spatial progress'));
		equal(await render({ progress }, 100), local, 'time independent');
		checks.push('texture progress and deterministic rendering');

		// 【解像度を変えても同じ座標の像が一致する】
		// 同じテクスチャを3倍解像度へ描画し、共通中心と倍率の計算へ画素数が
		// 混入していないことを、対応する画素中心で比較する。
		const ramp = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => [index % 33 / 16, Math.floor(index / 33) / 16, -1, 0.5]).flat());
		const parameters = { inputA: ramp, inputB: ramp, center: [0.13, -0.07] as const, progress: scalar(0.37), zoom: 3.7 };
		const low = await createEffect(33, 17)(parameters);
		const high = await createEffect(99, 51)(parameters);
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) {
				for (let channel = 0; channel < 4; channel++) near(low[(y * 33 + x) * 4 + channel], high[((y * 3 + 1) * 99 + x * 3 + 1) * 4 + channel], 'resolution independent');
			}
		}
		checks.push('resolution independent zoom');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

