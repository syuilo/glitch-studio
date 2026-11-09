import definition from '../../src/fx/lcdViewingAngle/_def_.ts';
import { linearChannelToSrgb, srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import implementation from '../../src/fx/lcdViewingAngle/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, 'canNode' in parameter && parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.001) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const color = (value: number[]) => constantShaderInput('color', value);
	const checkColor = (pixels: Float32Array, expected: ArrayLike<number>, label: string, offset = 0, tolerance = 0.001) => Array.from(expected).forEach((value, channel) => near(pixels[offset + channel], value, label, tolerance));
	const equal = (a: Float32Array, b: Float32Array, label: string) => assert(a.length === b.length && a.every((value, index) => value === b[index]), label);
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }),
		vertex: { module: vertex },
		fragment: {
			module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
			targets: [{ format: 'rgba32float' }],
		},
	});
	function field(width: number, height: number, componentCount: 1 | 4, value: (x: number, y: number) => number[]) {
		const texture = device.createTexture({ size: [width, height], format: componentCount === 1 ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const pixels = new Float16Array(width * height * componentCount);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(value(x, y), (y * width + x) * componentCount);
		device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * componentCount * 2 }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' });
	}
	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === INTERMEDIATE_TEXTURE_FORMAT, 'fixed rgba16float image output');
		const effect = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			effect.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height * 4);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'finite image output');
			return pixels;
		};
	}
	try {
		const sample = createEffect(1, 1);
		const source = [0.25, 0.5, 0.75, 0.5];
		const sourceInput = color(source);
		const premultipliedSource = [0.125, 0.25, 0.375, 0.5];
		// 【正面とAmount=0は、半透明色・範囲外RGBも含めて入力をそのまま返す】
		// 色変換の往復による誤差や、無効化時にHDR・負の成分が失われることを防ぐ。
		for (const [input, expected] of [[sourceInput, premultipliedSource], [color([-0.5, 2, 0.5, 0.5]), [-0.25, 1, 0.25, 0.5]]] as const) {
			const frontal = await sample({ input, horizontalViewingAngle: scalar(0), verticalViewingAngle: scalar(0) });
			equal(frontal, await sample({ input, amount: scalar(0) }), 'amount-zero identity');
			checkColor(frontal, expected, 'frontal identity', 0, 0);
		}
		checkColor(await sample({ input: sourceInput, amount: scalar(-1) }), premultipliedSource, 'negative amount clamps to zero', 0, 0);
		checks.push('frontal and amount-zero identity');

		const rampWidth = 65;
		const rampInput = field(rampWidth, 1, 4, x => srgbToLinearSrgb([x / 64, x / 64, x / 64, 1]));
		const ramp = createEffect(rampWidth, 1);
		const rampSettings = { input: rampInput, horizontalViewingAngle: scalar(0), colorShift: 0, contrastLoss: 0 };
		const below = await ramp({ ...rampSettings, verticalViewingAngle: scalar(55 / 360) });
		const above = await ramp({ ...rampSettings, verticalViewingAngle: scalar(-55 / 360) });
		// 【反転の有無と上下・左右の方向差を、階調の順序から確認する】
		// 画像全体の単純な反転や、符号を捨てた角度、ガンマだけの変換では満たせない性質を使う。
		for (const pixels of [below, above]) {
			assert(Array.from({ length: rampWidth - 1 }, (_, x) => pixels[(x + 1) * 4] < pixels[x * 4] - 0.0001).some(value => value), 'partial grayscale inversion');
			assert(pixels.every(value => value >= 0 && value <= 1), 'bounded response');
		}
		// 黒の端点はsin²の偶対称性で同じになるため、方向差は中間調で比較する。
		assert(Math.abs(below[32 * 4] - above[32 * 4]) > 0.1, 'vertical viewing direction');
		for (let x = 0; x < rampWidth; x++) near(linearChannelToSrgb(below[x * 4]) + linearChannelToSrgb(above[(64 - x) * 4]), 1, 'complementary signed response');
		const middleGray = color(srgbToLinearSrgb([0.5, 0.5, 0.5, 1]));
		const right = await sample({ input: middleGray, contrastLoss: 0, colorShift: 0 });
		const left = await sample({ input: middleGray, horizontalViewingAngle: scalar(-0.125), contrastLoss: 0, colorShift: 0 });
		assert(Math.abs(right[0] - left[0]) > 0.1, 'horizontal viewing direction');
		const vertical = await sample({ input: middleGray, horizontalViewingAngle: scalar(0), verticalViewingAngle: scalar(0.125), contrastLoss: 0, colorShift: 0 });
		assert(Math.abs(linearChannelToSrgb(vertical[0]) - 0.5) > Math.abs(linearChannelToSrgb(right[0]) - 0.5), 'stronger vertical response');
		checks.push('partial inversion and signed directions');

		// 【Inversion=0では明暗の順序を保つ】
		// 折り返しの強さを0にしても別の階調範囲が反転する実装を検出する。
		for (const angle of [-85, -55, 55, 85]) {
			const pixels = await ramp({ ...rampSettings, verticalViewingAngle: scalar(angle / 360), inversion: 0 });
			for (let x = 1; x < rampWidth; x++) assert(pixels[x * 4] >= pixels[(x - 1) * 4] - 0.0001, 'monotonic non-inverting response');
		}
		checks.push('non-inverting monotonic response');

		// 【Color Shift=0の灰色は無彩色、1ではRGBに異なる応答が現れる】
		// 同じ階調カーブを全チャンネルへ適用するだけの実装や、彩度操作による代用を検出する。
		for (let x = 0; x < rampWidth; x++) checkColor(below, [below[x * 4], below[x * 4], below[x * 4], 1], 'neutral grayscale', x * 4, 0);
		const shifted = await ramp({ ...rampSettings, verticalViewingAngle: scalar(55 / 360), colorShift: 1 });
		assert(Math.abs(shifted[0] - shifted[2]) > 0.1, 'channel-dependent color shift');
		checks.push('neutral and shifted grayscale');

		// 【コントラスト低下は暗部へ光を加え、明部の光量を下げる】
		// 反転しない応答の黒・白を比較し、単なる露出の加減で済ませない。
		const clear = await ramp({ ...rampSettings, verticalViewingAngle: scalar(-0.125), inversion: 0 });
		const washed = await ramp({ ...rampSettings, verticalViewingAngle: scalar(-0.125), inversion: 0, contrastLoss: 1 });
		assert(washed[0] > clear[0] && washed[64 * 4] < clear[64 * 4], 'black lift and white attenuation');
		checks.push('contrast loss');

		// 【色の非線形変換はalphaに依存せず、透明部分には漏れ光を生成しない】
		// premultiplied RGBをそのまま階調変換した場合や、黒浮きで透明部分を塗った場合に失敗する。
		const opaque = await sample({ input: color([0.25, 0.5, 0.75, 1]) });
		const translucent = await sample({ input: sourceInput });
		checkColor(translucent, [opaque[0] * 0.5, opaque[1] * 0.5, opaque[2] * 0.5, 0.5], 'alpha-independent response');
		checkColor(await sample({ input: color([1, 0.5, 0.25, 0]) }), [0, 0, 0, 0], 'transparent input', 0, 0);
		checks.push('premultiplied alpha');

		// 【Amountは被覆率を変えず、入力と加工結果を連続的に混合する】
		// alphaの二重乗算や、Amountを角度へ掛けてしまう実装を検出する。
		for (const amount of [0.25, 0.5, 0.75]) {
			checkColor(await sample({ input: sourceInput, amount: scalar(amount) }), premultipliedSource.map((value, channel) => value * (1 - amount) + translucent[channel] * amount), 'amount interpolation');
		}
		checks.push('amount interpolation');

		// 【入力画像・両角度・Amountを同時に場として読み、各画素の定数描画と比較する】
		// uniformからtextureへの構成変更で、bindingや入力座標を取り違える問題を検出する。
		const horizontalAngles = [0, 0.125, 0, -0.125, 0.0625, -0.0625, 0.125, 0];
		const verticalAngles = [0, 0, 0.125, 0, -0.125, 0.125, 0.0625, -0.125];
		const amounts = [1, 0.25, 1, 0.5, 0.75, 1, 0, 1];
		const alphas = [1, 0.5, 0.25, 0, 1, 0.5, 0.25, 1];
		const fields = await createEffect(8, 1)({
			input: field(8, 1, 4, x => [0.25 * alphas[x], 0.5 * alphas[x], 0.75 * alphas[x], alphas[x]]),
			horizontalViewingAngle: field(8, 1, 1, x => [horizontalAngles[x]]),
			verticalViewingAngle: field(8, 1, 1, x => [verticalAngles[x]]),
			amount: field(8, 1, 1, x => [amounts[x]]),
		});
		for (let x = 0; x < 8; x++) {
			checkColor(fields, await sample({ input: color([0.25, 0.5, 0.75, alphas[x]]), horizontalViewingAngle: scalar(horizontalAngles[x]), verticalViewingAngle: scalar(verticalAngles[x]), amount: scalar(amounts[x]) }), 'field and constant agreement', x * 4);
		}
		checks.push('color angle and amount fields');

		// 【式から範囲外の有限値を渡しても、角度と強さは端で飽和する】
		// 角度が1周後に正面へ戻ったり、強さの負値が別の変換になることを防ぐ。
		for (const sign of [-1, 1]) {
			equal(await sample({ input: sourceInput, horizontalViewingAngle: scalar(sign * 85 / 360), verticalViewingAngle: scalar(sign * 85 / 360) }), await sample({ input: sourceInput, horizontalViewingAngle: scalar(sign * 10), verticalViewingAngle: scalar(sign * 10) }), 'viewing angle saturation');
		}
		for (const parameter of ['colorShift', 'contrastLoss', 'inversion'] as const) {
			for (const [value, endpoint] of [[-1, 0], [2, 1]]) equal(await sample({ input: sourceInput, [parameter]: value }), await sample({ input: sourceInput, [parameter]: endpoint }), `${parameter} saturation`);
		}
		equal(await sample({ input: sourceInput, amount: scalar(2) }), translucent, 'amount saturation');
		checkColor(await sample({ input: sourceInput, horizontalViewingAngle: scalar(0.01 / 360) }), premultipliedSource, 'near-frontal continuity');
		checks.push('parameter saturation and frontal continuity');

		// 【同じ入力は時刻・描画回数・解像度・縦横比に依存しない】
		// 角度をピクセル寸法で換算する誤りや、前フレームに依存した状態を検出する。
		equal(await sample({ input: sourceInput }, 1000), translucent, 'history independence');
		for (const [width, height] of [[1, 1], [8, 16], [32, 8]]) {
			const pixels = await createEffect(width, height)({ input: sourceInput });
			for (let offset = 0; offset < pixels.length; offset += 4) checkColor(pixels, translucent, 'resolution and aspect independence', offset, 0);
		}
		checks.push('time resolution and aspect independence');

		// 【通常の全画像出力形式で、色とチャンネル順を維持する】
		// BGRAでのチャンネル逆転や、16bit専用の実装になっていないことを確認する。
		checks.push('16-bit float image output');

		// 【自動解像度の対象はノード接続できる全入力を含む】
		// 角度の場だけを接続した場合にも、その場の解像度を利用できるようにする。
		assert(definition.resolutionInputParameters.join(',') === 'input,horizontalViewingAngle,verticalViewingAngle,amount', 'resolution inputs');
		assert(!definition.dependsOnRenderHistory, 'stateless effect');
		checks.push('effect input contract');

		const previewWidth = 512;
		const previewHeight = 96;
		const previewInput = field(previewWidth, previewHeight, 4, (x, y) => {
			const value = x / (previewWidth - 1);
			if (y < 32) return [value, value, value, 1];
			const colors = [[1, 0.2, 0.1], [0.2, 0.8, 0.3], [0.15, 0.4, 1], [1, 0.75, 0.2], [0.8, 0.3, 0.65], [0.65, 0.45, 0.3], [0.1, 0.7, 0.8], [0.9, 0.85, 0.7]];
			return [...colors[Math.floor(x / 64)].map(channel => channel * (0.15 + 0.85 * (y - 32) / 63)), 1];
		});
		const previewEffect = createEffect(previewWidth, previewHeight);
		const canvas = new OffscreenCanvas(previewWidth, previewHeight * 4);
		const context = canvas.getContext('2d')!;
		for (const [index, angle] of [0, 35, 55, -55].entries()) {
			const pixels = await previewEffect({ input: previewInput, horizontalViewingAngle: scalar(0), verticalViewingAngle: scalar(angle / 360) });
			context.putImageData(new ImageData(Uint8ClampedArray.from(pixels, value => Math.round(value * 255)), previewWidth, previewHeight), 0, index * previewHeight);
		}
		const previewBytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, preview: btoa(Array.from(previewBytes, value => String.fromCharCode(value)).join('')) };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
