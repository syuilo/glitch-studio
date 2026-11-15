import definition from '../../src/fx/pixelateTransition/_def_.ts';
import implementation from '../../src/fx/pixelateTransition/_impl_.ts';
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
		progress: scalar(0.5), maximumCellSize: 0.1, peakPosition: 0.5, mixWidth: 0.25, gridOffset: [0, 0], samples: 16, sizeReference: 'longSide',
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
		// 【画像テクスチャの端点へ連続して細部が戻る】
		// 最大点が端へ近い場合や複数標本でも、最後だけ元の画像へ飛ぶ実装を検出する。
		for (const [width, height] of [[33, 17], [17, 33]]) {
			const render = createEffect(width, height);
			const valuesA = Array.from({ length: width * height }, (_, index) => [index % width / 8, Math.floor(index / width) / 8, -1, 0.5]).flat();
			const valuesB = Array.from({ length: width * height }, (_, index) => [-index % width / 8, 1 + Math.floor(index / width) / 8, 2, 0.25]).flat();
			const inputA = textureInput(width, height, valuesA);
			const inputB = textureInput(width, height, valuesB);
			for (const peakPosition of [0, 0.5, 1]) {
				for (const samples of [1, 5, 64]) {
					for (const progress of [-1, 0, 0.000001, 0.999999, 1, 2]) {
						const pixels = await render({ inputA, inputB, peakPosition, samples, maximumCellSize: 1, mixWidth: 1, gridOffset: [0.13, -0.07], progress: scalar(progress) });
						equal(pixels, new Float32Array(progress < 0.5 ? valuesA : valuesB), 'continuous texture endpoint');
					}
				}
			}
			checks.push(`${width}x${height} continuous textured endpoints`);
		}

		// 【ピーク時には同じセルを同じ画素で置き換える】
		// 格子の中心と辺長を既知の画素位置へ合わせ、単なる色の混合ではなく
		// 入力参照位置がモザイク化されることを確認する。
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const render = createEffect(width, height);
			const centerX = (width - 1) / 2;
			const centerY = (height - 1) / 2;
			const values = Array.from({ length: width * height }, (_, index) => [(index % width) ** 2 / 1024, Math.floor(index / width) ** 2 / 1024, -1, 0.5]).flat();
			const input = textureInput(width, height, values);
			const parameters = { inputA: input, inputB: input, maximumCellSize: 8 / 65, peakPosition: 0.25, samples: 1 };
			const peak = await render({ ...parameters, progress: scalar(0.25) });
			const at = (pixels: Float32Array, x: number, y: number, channel: number) => pixels[(y * width + x) * 4 + channel];
			for (const [x, y] of [[centerX - 3, centerY], [centerX + 3, centerY], [centerX, centerY - 3], [centerX, centerY + 3]]) {
				near(at(peak, x, y, 0), centerX ** 2 / 1024, 'peak cell X center');
				near(at(peak, x, y, 1), centerY ** 2 / 1024, 'peak cell Y center');
			}
			const growing = await render({ ...parameters, progress: scalar(0.125) });
			const shrinking = await render({ ...parameters, progress: scalar(0.625) });
			near(at(growing, centerX + 3, centerY, 0), (centerX + 4) ** 2 / 1024, 'half-size growing cell');
			near(at(shrinking, centerX + 3, centerY, 0), (centerX + 4) ** 2 / 1024, 'half-size shrinking cell');
			const offset = await render({ ...parameters, progress: scalar(0.25), gridOffset: [4 / 65, 2 / 65] });
			near(at(offset, centerX + 3, centerY, 0), (centerX + 4) ** 2 / 1024, 'grid offset X');
			near(at(offset, centerX + 3, centerY, 1), (centerY - 2) ** 2 / 1024, 'grid offset Y');

			// 【複数標本はセル中心と異なる平均値を返す】
			// 二次関数の色を使い、中心だけの参照やalphaの二重乗算を検出する。
			const averaged = await render({ ...parameters, progress: scalar(0.25), samples: 4 });
			near(at(averaged, centerX, centerY, 0), ((centerX - 2) ** 2 + (centerX + 2) ** 2) / 2048, 'four sample mean X');
			near(at(averaged, centerX, centerY, 1), ((centerY - 2) ** 2 + (centerY + 2) ** 2) / 2048, 'four sample mean Y');
			near(at(averaged, centerX, centerY, 2), -1, 'negative sample preservation', 0);
			near(at(averaged, centerX, centerY, 3), 0.5, 'averaged alpha', 0);
			const reference = await render({ ...parameters, progress: scalar(0.25), maximumCellSize: 8 / 65 * height / 65 });
			const heightReference = await render({ ...parameters, progress: scalar(0.25), sizeReference: 'height' });
			equal(reference, heightReference, 'size reference keeps isotropic cells');
			checks.push(`${width}x${height} pixelation peak grid offset average and size reference`);
		}

		// 【混合期間は最大点を中心とする全幅】
		// 既知のsmoothstep値でHDR・負値・半透明RGBAを比較し、期間とalphaを混同しない。
		const render = createEffect(8, 4);
		for (const [progress, weight] of [[0.125, 0.15625], [0.25, 0.5], [0.375, 0.84375]]) {
			const pixels = await render({ maximumCellSize: 0, peakPosition: 0.25, mixWidth: 0.5, progress: scalar(progress) });
			pixels.forEach((value, index) => near(value, colorA[index % 4] * (1 - weight) + colorB[index % 4] * weight, 'mix timing and premultiplied color'));
		}
		for (const [progress, expected] of [[0.249, colorA], [0.25, colorB]] as const) {
			const pixels = await render({ peakPosition: 0.25, mixWidth: 0, progress: scalar(progress) });
			pixels.forEach((value, index) => near(value, expected[index % 4], 'cut at peak', 0));
		}
		const transparent = await render({ inputB: constantShaderInput('color', [8, -4, 2, 0]) });
		transparent.forEach((value, index) => near(value, colorA[index % 4] * 0.5, 'transparent replacement'));
		equal(await render({ peakPosition: 0 }), await render({ peakPosition: 0.001 }), 'minimum peak');
		equal(await render({ peakPosition: 1 }), await render({ peakPosition: 0.999 }), 'maximum peak');
		equal(await render({ mixWidth: -1 }), await render({ mixWidth: 0 }), 'minimum mix width');
		equal(await render({ samples: 0 }), await render({ samples: 1 }), 'minimum samples');
		equal(await render({ samples: 65 }), await render({ samples: 64 }), 'maximum samples');
		checks.push('mix timing HDR alpha and parameter bounds');

		// 【セル平均の画面外参照は接続のWrapに従う】
		// 格子を画面外へずらしたときも、エフェクト内で勝手に端を延長しない。
		const repeated = textureInput(4, 4, Array.from({ length: 16 }, () => colorA).flat());
		if (repeated.kind !== 'texture') throw new Error('Expected a texture input');
		const emptyOutside = textureShaderInput(repeated.texture, { filterMode: 'nearest', fitMode: 'stretch', wrapMode: 'transparent' });
		const parameters = { maximumCellSize: 4, gridOffset: [1, 0] as const, samples: 1 };
		const repeatedPixels = await render({ ...parameters, inputA: repeated, inputB: repeated });
		const clippedPixels = await render({ ...parameters, inputA: emptyOutside, inputB: emptyOutside });
		repeatedPixels.forEach((value, index) => near(value, colorA[index % 4], 'repeat outside'));
		clippedPixels.forEach(value => near(value, 0, 'transparent outside', 0));
		checks.push('input wrap preservation');

		// 【局所進捗と再現性】進捗はセル中心ではなく出力位置で評価する。
		// 同じセルでも進捗0/1の位置が別々の入力を選べることを確認する。
		const progressValues = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1);
		const progress = textureInput(8, 4, progressValues, true);
		const local = await render({ progress, maximumCellSize: 1 });
		local.forEach((value, index) => near(value, (progressValues[Math.floor(index / 4)] === 0 ? colorA : colorB)[index % 4], 'spatial progress'));
		equal(await render({ progress, maximumCellSize: 1 }, 100), local, 'time independent');
		checks.push('texture progress and deterministic rendering');

		// 【画素数を増やしても同じセルと標本位置を使う】
		// 同じ画像を3倍解像度へ描画し、対応する画素中心でモザイクを照合する。
		const ramp = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => [index % 33 / 16, Math.floor(index / 33) / 16, -1, 0.5]).flat());
		const sampled = { inputA: ramp, inputB: ramp, maximumCellSize: 0.23, gridOffset: [0.13, -0.07] as const, progress: scalar(0.37), samples: 5 };
		const low = await createEffect(33, 17)(sampled);
		const high = await createEffect(99, 51)(sampled);
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) {
				for (let channel = 0; channel < 4; channel++) near(low[(y * 33 + x) * 4 + channel], high[((y * 3 + 1) * 99 + x * 3 + 1) * 4 + channel], 'resolution independent');
			}
		}
		checks.push('resolution independent pixelation');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

