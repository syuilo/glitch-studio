import definition from '../../src/fx/vhsPlayback/_def_.ts';
import implementation from '../../src/fx/vhsPlayback/_impl_.ts';
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
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: INTERMEDIATE_TEXTURE_FORMAT, enable32bitDataTextures: false };
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
		const clean: Partial<Parameters> = {
			trackingOffset: 0, trackAlignmentError: 0, timeBaseError: 0, tapeDeformation: 0,
			headContact: 1, headSpacingLoss: 0, headSwitching: false, dropoutRate: 0,
			rfNoiseFloor: -100, dropoutCompensation: false, timeBaseCorrection: 1,
		};
		// 【正常なFM記録・復調では、振幅や搬送波の位相を画素値と取り違えない】
		// 異なる明るさの無彩色を往復し、FM変換の定数・符号・帯域抽出を実際に検証する。
		for (const gray of [0.15, 0.45, 0.8]) {
			checkColor(await sample({ ...clean, input: color([gray, gray, gray, 1]) }), [gray, gray, gray, 1], 'clean grayscale', 0, 0.025);
		}
		checks.push('FM grayscale round trip');

		// 【カラーアンダー信号を復調すると、元の色相と彩度が概ね戻る】
		// 輝度FMだけを処理した実装や、I/Qの符号・バースト補正の誤りを検出する。
		const opaque = await sample({ ...clean, input: color([0.25, 0.5, 0.75, 1]) });
		checkColor(opaque, [0.25, 0.5, 0.75, 1], 'color-under round trip', 0, 0.065);
		checks.push('color-under round trip');

		// 【被覆率を保持するモードでは、信号処理によって透明部分を不透明にしない】
		// ノイズの直接加算や、premultiplied色をそのまま変調する実装では満たせない。
		const translucent = await sample({ ...clean, input: color([0.25, 0.5, 0.75, 0.5]) });
		checkColor(translucent, Array.from(opaque, (value, channel) => channel === 3 ? 0.5 : value * 0.5), 'coverage-independent color', 0, 0.003);
		checkColor(await sample({ input: color([1, 0.5, 0.25, 0]) }), [0, 0, 0, 0], 'transparent signal', 0, 0);
		checks.push('premultiplied coverage');

		// 【不透明モードでは背景色へ合成してから録画する】
		// 背景が復調後に貼られ、信号処理を通らない問題を防ぐ。
		checkColor(await sample({ ...clean, input: color([0.8, 0.2, 0.2, 0]), alphaMode: 'opaque', backgroundColor: [0.4, 0.4, 0.4, 1] }), [0.4, 0.4, 0.4, 1], 'background before recording', 0, 0.025);
		checks.push('background before recording');

		const render = createEffect(64, 48);
		const image = field(64, 48, 4, (x, y) => {
			const value = 0.2 + 0.6 * ((Math.floor(x / 8) + Math.floor(y / 8)) % 2);
			return [value, value, value, 1];
		});
		const settings = { input: image, seed: 37, time: 1.25 };
		const first = await render(settings);
		// 【同じテープ位置は、シーク・別入力の描画・異なる時計から戻っても同じ結果になる】
		// 前フレームやctx.timeDeltaに基づく乱数・補償履歴への依存を検出する。
		await render({ ...settings, time: 9, seed: 3 }, 100);
		equal(first, await render(settings, 500), 'history-independent tape replay');
		const changedTime = await render({ ...settings, time: 1.5 });
		assert(changedTime.some((value, index) => value !== first[index]), 'tape advances with Time');
		const changedSeed = await render({ ...settings, seed: 38 });
		assert(changedSeed.some((value, index) => value !== first[index]), 'independent tape seed');
		checks.push('deterministic tape time and seed');

		// 【信号振幅の軽い低下では画像を暗くせず、FM信号が読める範囲で明るさを保つ】
		// 接触率をRGBやalphaへ単純に乗算する代用を防ぐ。
		const contact = await sample({ ...clean, input: color([0.45, 0.45, 0.45, 1]), headContact: 0.35 });
		checkColor(contact, [0.45, 0.45, 0.45, 1], 'FM amplitude rejection', 0, 0.03);
		checks.push('FM amplitude rejection');

		// 【同じ仮想フィールドを別の出力解像度で描画しても、損傷の相対位置を変えない】
		// 出力ピクセル・フレーム数を乱数や内部サンプル数へ混ぜる実装を検出する。
		const larger = createEffect(128, 96);
		const large = await larger(settings);
		let difference = 0;
		for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
			for (let channel = 0; channel < 3; channel++) {
				const average = [0, 1].flatMap(dy => [0, 1].map(dx => large[((y * 2 + dy) * 128 + x * 2 + dx) * 4 + channel])).reduce((sum, value) => sum + value, 0) / 4;
				difference += Math.abs(average - first[(y * 64 + x) * 4 + channel]);
			}
		}
		assert(difference / (64 * 48 * 3) < 0.035, 'resolution-independent signal model');
		checks.push('resolution-independent signal');

		// 【時間軸補正は、復調した同期に基づいて輪郭の水平位置を復元する】
		// 元の画像へ逆変形をかけるだけの補正や、同期パルスの誤検出を検出する。
		const edge = field(64, 48, 4, x => x < 32 ? [0.2, 0.2, 0.2, 1] : [0.8, 0.8, 0.8, 1]);
		const stable = await render({ ...clean, input: edge });
		const shifted = await render({ ...clean, input: edge, timeBaseError: 3, tapeDeformation: 6, timeBaseCorrection: 0 });
		const corrected = await render({ ...clean, input: edge, timeBaseError: 3, tapeDeformation: 6, timeBaseCorrection: 1 });
		const edgeError = (values: Float32Array) => Array.from({ length: 48 }, (_, y) => {
			let total = 0;
			for (let x = 22; x < 42; x++) total += Math.abs(values[(y * 64 + x) * 4] - stable[(y * 64 + x) * 4]);
			return total;
		}).reduce((sum, value) => sum + value, 0);
		assert(edgeError(corrected) < edgeError(shifted), `sync-based time-base correction: ${edgeError(corrected)} >= ${edgeError(shifted)}`);
		checks.push('sync-based time-base correction');

		// 【欠損補償を有効にすると、一定画像の白黒スパイクが減少する】
		// 欠損の位置を変えず、同じRF信号の1H補償だけを切り替えて比較する。
		const damaged = { ...clean, input: color([0.45, 0.45, 0.45, 1]), dropoutRate: 4000, dropoutDuration: 18, dropoutDepth: 1, rfNoiseFloor: -36, seed: 42 };
		const uncompensated = await render({ ...damaged, dropoutCompensation: false });
		const compensated = await render({ ...damaged, dropoutCompensation: true });
		const grayscaleError = (values: Float32Array) => values.reduce((sum, value, index) => sum + (index % 4 === 0 ? Math.abs(value - 0.45) : 0), 0);
		assert(grayscaleError(compensated) < grayscaleError(uncompensated), '1H dropout compensation improves constant image');
		checks.push('1H dropout compensation');

		// 【色信号は輝度より狭い帯域で記録され、細かな色縞が優先して失われる】
		// RGBを同じカーネルでぼかす代用では満たせない、VHSの帯域差を確認する。
		const fineGray = field(64, 48, 4, x => {
			const value = 0.5 + (x % 2 === 0 ? 0.12 : -0.12);
			return [value, value, value, 1];
		});
		const fineChroma = field(64, 48, 4, x => {
			const value = x % 2 === 0 ? 0.12 : -0.12;
			return [0.5 + 0.9563 * value, 0.5 - 0.2721 * value, 0.5 - 1.107 * value, 1];
		});
		const grayStripes = await render({ ...clean, input: fineGray });
		const colorStripes = await render({ ...clean, input: fineChroma });
		let grayContrast = 0;
		let colorContrast = 0;
		for (let x = 8; x < 56; x++) {
			const index = (24 * 64 + x) * 4;
			grayContrast += Math.abs(grayStripes[index] - 0.5);
			colorContrast += Math.abs(colorStripes[index] - colorStripes[index + 2]) / 2.0633;
		}
		assert(colorContrast < grayContrast * 0.5, 'narrower chroma recording bandwidth');
		checks.push('separate luminance and chroma bandwidth');

		// 【ヘッド切替による乱れは切替点付近に現れ、上部の画像へ波及しない】
		// 独立した乱数の横帯を重ねる実装や、画面全体の時間ずれとの混同を防ぐ。
		const noSwitch = await render({ ...clean, input: image, timeBaseCorrection: 0, headTimingDifference: 5 });
		const switched = await render({ ...clean, input: image, timeBaseCorrection: 0, headTimingDifference: 5, headSwitching: true });
		assert(noSwitch.slice(0, 40 * 64 * 4).every((value, index) => value === switched[index]), 'head switching leaves earlier lines unchanged');
		assert(noSwitch.slice(46 * 64 * 4).some((value, index) => value !== switched[46 * 64 * 4 + index]), 'head switching affects lower lines');
		checks.push('head switching location');

		// 【信号計算と画像出力の保存形式を分離する】
		// 信号の符号や振幅を保持する検証に加え、画像の固定形式はcreateEffectの生成時に確認する。
		checks.push('16-bit float image output');

		const previewWidth = 512;
		const previewHeight = 384;
		const bars = [[1, 1, 1], [1, 1, 0], [0, 1, 1], [0, 1, 0], [1, 0, 1], [1, 0, 0], [0, 0, 1], [0.05, 0.05, 0.05]];
		const previewColorAt = (x: number, y: number) => {
			if (y < 144) return [...bars[Math.floor(x / 64)], 1];
			if (y < 240) return [x / 511, x / 511, x / 511, 1];
			if ((x - 256) ** 2 + (y - 306) ** 2 < 45 ** 2) return [0.1, 0.8, 1, 1];
			const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 0.1 : 0.8;
			return [value, value, value, 1];
		};
		const previewInput = field(previewWidth, previewHeight, 4, previewColorAt);
		const previewEffect = createEffect(previewWidth, previewHeight);
		const canvas = new OffscreenCanvas(previewWidth * 3, previewHeight);
		const context = canvas.getContext('2d')!;
		const original = new ImageData(previewWidth, previewHeight);
		for (let y = 0; y < previewHeight; y++) for (let x = 0; x < previewWidth; x++) {
			original.data.set(previewColorAt(x, y).map(value => Math.round(value * 255)), (y * previewWidth + x) * 4);
		}
		context.putImageData(original, 0, 0);
		for (const [index, values] of [await previewEffect({ input: previewInput, time: 1.25, seed: 37 }), await previewEffect({ input: previewInput, time: 1.25, seed: 37, trackingOffset: 0.4, trackAlignmentError: 2, dropoutRate: 1200 })].entries()) {
			context.putImageData(new ImageData(Uint8ClampedArray.from(values, value => Math.round(value * 255)), previewWidth, previewHeight), (index + 1) * previewWidth, 0);
		}
		const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
		return { checks, preview: btoa(Array.from(bytes, value => String.fromCharCode(value)).join('')) };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
