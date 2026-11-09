import definition from '../../src/fx/vignette/_def_.ts';
import implementation from '../../src/fx/vignette/_impl_.ts';
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
	const defaults: Parameters = { input: constantShaderInput('color', [0.8, 0.4, 0.2, 0.5]), strength: 0.5, sizeReference: 'longSide', center: [0, 0], size: [0.8, 0.8], rotation: 0, feather: 0.4 };
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.001) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => assert(actual.length === expected.length && actual.every((value, index) => value === expected[index]), label);
	const colorAt = (pixels: Float32Array, expected: number[], label: string, offset = 0, tolerance = 0.001) => expected.forEach((value, channel) => near(pixels[offset + channel], value, label, tolerance));
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
	function createEffect(width: number, height: number, precise: boolean) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const mask = implementation.outputTextureFactories.mask({ wgpu, resolution });
		assert(mask.format === (precise ? 'r32float' : 'r16float'), 'mask precision');
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		disposables.push(() => { instance.dispose(); output.destroy(); mask.destroy(); });
		const outputData = (texture: GPUTexture) => ({ texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null });
		return async (overrides: Partial<Parameters> = {}, includeMask = true, time = 0) => {
			const encoder = device.createCommandEncoder();
			instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: outputData(output), ...(includeMask ? { mask: outputData(mask) } : {}) },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor), createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			device.queue.submit([encoder.finish()]);
			const color = await read(output);
			const maskPixels = includeMask ? await read(mask) : null;
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(color.every(Number.isFinite), 'finite color');
			const values = maskPixels == null ? new Float32Array() : Float32Array.from({ length: width * height }, (_, index) => maskPixels[index * 4]);
			assert(values.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'finite mask in range');
			return { color, mask: values };
		};
	}
	try {
		// 【画像加工と独立した遅延Maskの定義】主入出力・解像度の参照先と
		// 履歴非依存を確認し、UIの自動接続やレンダラーの出力確保へ正しく組み込む。
		assert(definition.kind === 'modify' && definition.primaryInputParameter === 'input' && definition.primaryOutput === 'output', 'primary color ports');
		assert(definition.resolutionInputParameters.join(',') === 'input' && !definition.dependsOnRenderHistory, 'resolution and history contract');
		assert(definition.outputDefs.output.dataType.kind === 'color' && definition.outputDefs.mask.dataType.kind === 'scalar' && definition.outputDefs.mask.canLazyAllocation, 'lazy scalar mask');
		checks.push('definition and lazy output contract');
		for (const precise of [false, true]) {
			const label = precise ? '32bit' : '16bit';
			const maskNear = (actual: number, expected: number, message: string) => near(actual, expected, `${label}: ${message}`, precise ? 4e-6 : 0.0006);
			const sample = createEffect(65, 65, precise);
			const at = async (x: number, y: number, overrides: Partial<Parameters> = {}) => {
				const result = await sample({ ...overrides, center: [-x, -y] });
				const centerIndex = 32 * 65 + 32;
				return { color: result.color.subarray(centerIndex * 4, centerIndex * 4 + 4), mask: result.mask.subarray(centerIndex, centerIndex + 1) };
			};

			// 【Featherの中心と両端、減光量と透明度】実距離が既知の円を使い、
			// Sizeを半径として扱う誤り、Featherを片側に広げる誤り、alphaの二重乗算を検出する。
			for (const [x, expectedMask] of [[0, 0], [0.25, 0], [0.375, 0.15625], [0.5, 0.5], [0.625, 0.84375], [0.75, 1]]) {
				const result = await at(x, 0, { size: [1, 1], feather: 0.5 });
				maskNear(result.mask[0], expectedMask, 'feather full width');
				colorAt(result.color, [0.4 * (1 - 0.5 * expectedMask), 0.2 * (1 - 0.5 * expectedMask), 0.1 * (1 - 0.5 * expectedMask), 0.5], 'premultiplied attenuation');
			}
			checks.push(`${label}: feather midpoint endpoints and alpha`);

			// 【強度の上下限と完全透明色】強度0は入力保持、強度1は周辺を黒にする。
			// Maskは強度と入力の色・alphaに依存せず、透明色に不透明な黒を足さない。
			const baseline = await at(1, 0);
			for (const strength of [-1, 0, 1, 2]) {
				const result = await at(1, 0, { strength });
				const factor = strength <= 0 ? 1 : 0;
				colorAt(result.color, [0.4 * factor, 0.2 * factor, 0.1 * factor, 0.5], 'strength endpoints');
				equal(result.mask, baseline.mask, 'strength-independent mask');
			}
			const transparent = await at(1, 0, { input: constantShaderInput('color', [1, 0, 1, 0]) });
			colorAt(transparent.color, [0, 0, 0, 0], 'transparent input');
			equal(transparent.mask, baseline.mask, 'alpha-independent mask');
			checks.push(`${label}: strength clamp and transparent input`);

			// 【楕円の法線方向に同じ距離だけ離れた点】長軸・短軸・斜めのFeather幅を
			// 独立した既知の法線距離と照合し、円を引き延ばしただけの近似を検出する。
			for (const angle of [0, 0.7, Math.PI / 2]) for (const distance of [-0.01, 0, 0.02]) {
				const a = 0.4;
				const b = 0.15;
				const nx = Math.cos(angle) / a;
				const ny = Math.sin(angle) / b;
				const normalLength = Math.hypot(nx, ny);
				const result = await at(a * Math.cos(angle) + distance * nx / normalLength, b * Math.sin(angle) + distance * ny / normalLength, { size: [a * 2, b * 2], feather: 0.1 });
				const t = 0.5 + distance / 0.1;
				maskNear(result.mask[0], t * t * (3 - 2 * t), 'Euclidean ellipse feather');
			}
			checks.push(`${label}: uniform Euclidean ellipse feather`);

			// 【時計回りの回転と周期】非対称な楕円で回転方向を区別し、
			// 負の角度・整数周の加算によって見た目が変わらないことを確認する。
			for (const rotation of [0.125, -0.875, 1000.125]) {
				maskNear((await at(0.2, -0.2, { size: [0.8, 0.2], feather: 0, rotation })).mask[0], 0, 'clockwise long axis');
				maskNear((await at(0.2, 0.2, { size: [0.8, 0.2], feather: 0, rotation })).mask[0], 1, 'clockwise short axis');
			}
			checks.push(`${label}: clockwise rotation and periodicity`);

			// 【Size Referenceで位置を換算しない】横長・縦長の画面で
			// SizeとFeatherだけが同じ基準倍率を受け、Centerは共通座標を保つことを確認する。
			for (const [width, height] of [[129, 65], [65, 129]]) {
				const render = createEffect(width, height, precise);
				const common = { center: [0.1, -0.05] as const, rotation: 0.07 };
				const original = await render(common);
				for (const sizeReference of ['height', 'width', 'shortSide', 'longSide'] as const) {
					const reference = { height, width, shortSide: Math.min(width, height), longSide: Math.max(width, height) }[sizeReference];
					const scale = Math.max(width, height) / reference;
					const result = await render({ ...common, sizeReference, size: [0.8 * scale, 0.8 * scale], feather: 0.4 * scale });
					result.mask.forEach((value, index) => maskNear(value, original.mask[index], 'reference conversion'));
				}
			}
			checks.push(`${label}: size reference preserves center`);

			// 【解像度と縦横比、上方向の共通座標】同じ画素中心に対応する位置で
			// Maskを比較し、円が縦横比によって引き延ばされないことも確認する。
			const settings = { size: [0.6, 0.6] as const, center: [0, 0.1] as const, feather: 0.2 };
			const small = await createEffect(65, 65, precise)(settings);
			const large = await createEffect(195, 195, precise)(settings);
			const wide = await createEffect(129, 65, precise)({ ...settings, center: [0, 0] });
			for (const y of [8, 24, 32, 48, 56]) for (const x of [8, 24, 32, 48, 56]) {
				maskNear(large.mask[(y * 3 + 1) * 195 + x * 3 + 1], small.mask[y * 65 + x], 'resolution independence');
				maskNear(wide.mask[y * 129 + x + 32], wide.mask[x * 129 + y + 32], 'isotropic circle');
			}
			assert(small.mask[8 * 65 + 32] < small.mask[56 * 65 + 32], 'positive center Y moves up');
			checks.push(`${label}: resolution aspect ratio and positive Y`);

			// 【Feather 0でもAAを保つ】境界を画素中心へわずかにずらし、
			// 二値のジャギーにせず、負のFeatherが0と同じになることを確認する。
			const render = createEffect(65, 65, precise);
			const hard = await render({ size: [0.503, 0.503], feather: 0 });
			assert(hard.mask.some(value => value > 0 && value < 1), 'zero feather keeps AA');
			equal((await render({ size: [0.503, 0.503], feather: -1 })).mask, hard.mask, 'negative feather clamp');
			for (const size of [[0, 0.5], [0.5, 0], [-1, 0.5]] as const) {
				const result = await render({ size, feather: 200000 });
				assert(result.mask.every(value => value === 1), 'empty ellipse is fully affected');
			}
			checks.push(`${label}: AA and degenerate ellipses`);

			// 【Maskの有無を切り替えても画像が変わらない】出力を省略したpipelineも
			// 実行し、異なるパラメータ・時刻で描画した後に元の結果を再現できることを確認する。
			const original = await render();
			equal((await render({}, false)).color, original.color, 'optional mask preserves image');
			await render({ center: [0.2, 0.1], size: [0.4, 0.7], rotation: 0.2, strength: 0.9 });
			const restored = await render({}, true, 123);
			equal(restored.mask, original.mask, 'time and history independent mask');
			equal(restored.color, original.color, 'time and history independent image');
			checks.push(`${label}: optional mask and deterministic updates`);
		}

		// 【画像テクスチャの接続・半透明境界・Fitの透明余白】定数入力だけでなく
		// 実際の画像入力を使い、余白の透明度とpremultiplied RGBを保持することを確認する。
		const input = device.createTexture({ size: [2, 2], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		disposables.push(() => input.destroy());
		device.queue.writeTexture({ texture: input }, new Uint8Array([128, 64, 32, 128, 0, 0, 0, 0, 255, 128, 64, 255, 0, 0, 0, 0]), { bytesPerRow: 8 }, [2, 2]);
		{
			const render = createEffect(8, 4, false);
			const image = textureShaderInput(input, { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' });
			const before = await render({ input: image, strength: 0 });
			const after = await render({ input: image, strength: 1, size: [0, 0] });
			colorAt(before.color, [128 / 255, 64 / 255, 32 / 255, 128 / 255], 'texture input is already premultiplied', (1 * 8 + 2) * 4, 0.004);
			for (let index = 0; index < 32; index++) {
				colorAt(after.color, [0, 0, 0, before.color[index * 4 + 3]], 'texture alpha preservation', index * 4, 0.004);
				if (index % 8 < 2 || index % 8 >= 6) colorAt(before.color, [0, 0, 0, 0], 'transparent fit margins', index * 4);
			}
		}
		checks.push('texture sampling transparent fit and 16-bit float color output');
		return { checks };
	} finally {
		for (const dispose of disposables) dispose();
		device.destroy();
	}
}
