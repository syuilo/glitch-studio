import definition from '../../src/fx/phaseScramble/_def_.ts';
import implementation from '../../src/fx/phaseScramble/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Color = [number, number, number, number];
const gray = (value: number, alpha = 1): Color => [value * alpha, value * alpha, value * alpha, alpha];

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }),
		vertex: { module: vertex },
		fragment: {
			module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }),
			targets: [{ format: 'rgba32float' }],
		},
	});
	const defaults: Parameters = {
		input: constantShaderInput('color', [0, 0, 0, 0]), processing: 'global', amount: 0.75, minFrequency: 0, maxFrequency: 10000, softness: 0,
		seed: 0, evolution: 0, channelMode: 'linked', boundary: 'repeat', analysisResolution: '16', blockSize: 50, blockResolution: '16', sizeReference: 'longSide',
	};
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	function texture(width: number, height: number, pixels: Color[], sampling: Partial<ShaderInputSampling> = {}) {
		if (pixels.length !== width * height) throw new Error('Invalid test image size');
		const image = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture: image }, new Float16Array(pixels.flat()), { bytesPerRow: width * 8 }, [width, height]);
		disposables.push(() => image.destroy());
		return textureShaderInput(image, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest', ...sampling });
	}
	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba16float' as const, enable32bitDataTextures: false };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const effect = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const copyTarget = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const commandEncoder = device.createCommandEncoder();
			effect.render({
				params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta: 0,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
				createComputePassEncoder: encoder => encoder.beginComputePass(),
				createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(3); pass.end();
			commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([commandEncoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height * 4);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			return pixels;
		};
	}
	function compare(actual: Float32Array, expected: Color[], label: string) {
		const components = expected.flat();
		if (actual.length !== components.length) throw new Error(`${label}: dimensions`);
		actual.forEach((value, index) => {
			if (!Number.isFinite(value) || Math.abs(value - components[index]) > 0.001) throw new Error(`${label}: pixel ${Math.floor(index / 4)} channel ${index % 4}: ${value} != ${components[index]}`);
		});
		checks.push(label);
	}
	function colors(pixels: Float32Array): Color[] {
		return Array.from({ length: pixels.length / 4 }, (_, index) => Array.from(pixels.subarray(index * 4, index * 4 + 4)) as Color);
	}
	function quantized(pixels: Color[]): Color[] {
		return pixels.map(color => Array.from(new Float16Array(color)) as Color);
	}
	function changed(actual: Float32Array, original: Color[], label: string) {
		if (!(Math.max(...actual.map((value, index) => Math.abs(value - original[Math.floor(index / 4)][index % 4]))) > 0.01)) throw new Error(label + ': no visible change');
		checks.push(label);
	}
	function hashInteger(value: number) {
		let result = value >>> 0;
		result = Math.imul(result ^ (result >>> 16), 0x7feb352d) >>> 0;
		result = Math.imul(result ^ (result >>> 15), 0x846ca68b) >>> 0;
		return (result ^ (result >>> 16)) >>> 0;
	}
	function phaseOffset(frequency: number, block: number, channel: number, seed: number, evolution: number) {
		const seedBits = new Uint32Array(new Float32Array([seed]).buffer)[0];
		const step = Math.floor(evolution);
		const random = (time: number) => {
			const key = hashInteger(frequency ^ hashInteger((block + 0x9e3779b9) >>> 0) ^ hashInteger((channel + 0x85ebca6b) >>> 0) ^ hashInteger(seedBits) ^ hashInteger(time >>> 0));
			return ((key >>> 8) / 16777216 - 0.5) * 2 * Math.PI;
		};
		const fraction = evolution - step;
		const weight = fraction * fraction * (3 - 2 * fraction);
		return random(step) * (1 - weight) + random(step + 1) * weight;
	}
	// FFTのbutterflyを再実装せず、定義式の全和で係数と逆変換を独立に求める。
	function directSpectrum(pixels: Color[], width: number, height: number) {
		const spectrum = new Float64Array(width * height * 6);
		for (let frequency = 0; frequency < width * height; frequency++) {
			const frequencyX = frequency % width;
			const frequencyY = Math.floor(frequency / width);
			for (let pixel = 0; pixel < pixels.length; pixel++) {
				const angle = -2 * Math.PI * (frequencyX * (pixel % width) / width + frequencyY * Math.floor(pixel / width) / height);
				const cosine = Math.cos(angle);
				const sine = Math.sin(angle);
				for (let channel = 0; channel < 3; channel++) {
					spectrum[frequency * 6 + channel] += pixels[pixel][channel] * cosine;
					spectrum[frequency * 6 + channel + 3] += pixels[pixel][channel] * sine;
				}
			}
		}
		return spectrum;
	}
	function directReference(pixels: Color[], width: number, height: number, overrides: Partial<Parameters> = {}, frequencyScale: [number, number] = [1, 1]): Color[] {
		const params = { ...defaults, ...overrides };
		const spectrum = directSpectrum(pixels, width, height);
		const delta = new Float64Array(spectrum.length);
		for (let frequency = 0; frequency < width * height; frequency++) {
			const x = frequency % width;
			const y = Math.floor(frequency / width);
			const partner = ((height - y) % height) * width + (width - x) % width;
			if (frequency === partner) continue;
			const radialFrequency = Math.hypot((x > width / 2 ? x - width : x) * frequencyScale[0], (y > height / 2 ? y - height : y) * frequencyScale[1]);
			let weight = radialFrequency >= params.minFrequency && radialFrequency <= params.maxFrequency ? 1 : 0;
			if (params.softness > 0) {
				const smooth = (lower: number, upper: number) => {
					const value = Math.max(0, Math.min(1, (radialFrequency - lower) / (upper - lower)));
					return value * value * (3 - 2 * value);
				};
				weight = (params.minFrequency > 0 ? smooth(params.minFrequency - params.softness, params.minFrequency + params.softness) : 1)
					* (1 - smooth(params.maxFrequency - params.softness, params.maxFrequency + params.softness));
			}
			for (let channel = 0; channel < 3; channel++) {
				const angle = phaseOffset(Math.min(frequency, partner), 0, params.channelMode === 'independent' ? channel : 0, params.seed, params.evolution) * params.amount * weight * (frequency < partner ? 1 : -1);
				const cosine = Math.cos(angle) - 1;
				const sine = Math.sin(angle);
				const real = spectrum[frequency * 6 + channel];
				const imaginary = spectrum[frequency * 6 + channel + 3];
				delta[frequency * 6 + channel] = real * cosine - imaginary * sine;
				delta[frequency * 6 + channel + 3] = real * sine + imaginary * cosine;
			}
		}
		return pixels.map((pixel, index) => {
			const result: Color = [...pixel];
			if (pixel[3] <= 0) return [0, 0, 0, 0];
			for (let frequency = 0; frequency < width * height; frequency++) {
				const angle = 2 * Math.PI * ((frequency % width) * (index % width) / width + Math.floor(frequency / width) * Math.floor(index / width) / height);
				for (let channel = 0; channel < 3; channel++) result[channel] += (delta[frequency * 6 + channel] * Math.cos(angle) - delta[frequency * 6 + channel + 3] * Math.sin(angle)) / pixels.length * pixel[3];
			}
			return result;
		});
	}
	try {
		const pixels: Color[] = Array.from({ length: 256 }, (_, index) => {
			const x = index % 16;
			const y = Math.floor(index / 16);
			return [0.5 + 0.2 * Math.cos(2 * Math.PI * (2 * x + 3 * y) / 16), 0.4 + 0.15 * Math.sin(2 * Math.PI * (x - y) / 16), 0.25 + 0.125 * Math.cos(2 * Math.PI * x / 16), 1];
		});
		const sourcePixels = quantized(pixels);
		const input = texture(16, 16, pixels);
		const render = createEffect(16, 16);
		const base: Partial<Parameters> = { input };

		// 【GlobalのFFT・位相回転・逆FFTをCPUの直接DFT定義式と照合する】
		// bit反転・軸・正負のtwiddle・正規化・共役対の誤りは、見た目だけでは判別できない。
		const globalResult = await render(base);
		compare(globalResult, directReference(sourcePixels, 16, 16), 'global FFT agrees with direct CPU DFT');
		compare(await render({ ...base, channelMode: 'independent', seed: 2.5, evolution: -0.25 }), directReference(sourcePixels, 16, 16, { channelMode: 'independent', seed: 2.5, evolution: -0.25 }), 'independent RGB and negative evolution agree with DFT');
		compare(await render({ ...base, minFrequency: 1, maxFrequency: 4, softness: 0.75 }), directReference(sourcePixels, 16, 16, { minFrequency: 1, maxFrequency: 4, softness: 0.75 }), 'soft frequency selection agrees with DFT');

		// 【不透明・等倍・Repeatの解析領域ではDCと各周波数振幅を保持する】
		// 位相回転が複素係数の線形混合になって振幅を落とす不具合を、全係数で検出する。
		const beforeSpectrum = directSpectrum(sourcePixels, 16, 16);
		const afterSpectrum = directSpectrum(colors(globalResult), 16, 16);
		for (let frequency = 0; frequency < 256; frequency++) {
			for (let channel = 0; channel < 3; channel++) {
				const before = Math.hypot(beforeSpectrum[frequency * 6 + channel], beforeSpectrum[frequency * 6 + channel + 3]);
				const after = Math.hypot(afterSpectrum[frequency * 6 + channel], afterSpectrum[frequency * 6 + channel + 3]);
				if (Math.abs(before - after) / 256 > 0.0005) throw new Error('Spectral magnitude changed at ' + frequency);
			}
		}
		checks.push('opaque native global processing preserves spectral magnitudes and DC');

		// 【Amount=0・帯域外・一様入力で元画像のRGBAを保持する】
		// バイパスでFFT用bufferを読む誤りや、ブロック窓自体が模様として乱れる処理を防ぐ。
		for (const processing of ['global', 'blocks'] as const) {
			compare(await render({ ...base, processing, amount: 0 }), sourcePixels, processing + ' zero amount is an exact bypass');
			compare(await render({ ...base, processing, minFrequency: 100000, maxFrequency: 100001 }), sourcePixels, processing + ' excluded frequencies add zero difference');
			const constantPixels = Array.from({ length: 256 }, () => [0.25, 0.125, 0.5, 0.5] as Color);
			compare(await render({ processing, input: texture(16, 16, constantPixels) }), constantPixels, processing + ' uniform texture keeps its color and alpha');
			compare(await render({ processing, input: constantShaderInput('color', [0.5, 0.25, 1, 0.5]) }), constantPixels, processing + ' constant input is premultiplied only once');
			const first = await render({ ...base, processing });
			changed(first, sourcePixels, processing + ' actually changes image structure');
			compare(await render({ ...base, processing }, 100), colors(first), processing + ' is independent of frame time and previous changes');
			changed(await render({ ...base, processing, seed: 1 }), colors(first), processing + ' seed changes the phase pattern');
		}

		// 【Evolutionは整数境界でも連続し、同じ値へ戻せば描画順によらず再現する】
		// フレームごとの乱数や角度の折返し補間によるちらつきを避けるための仕様を確認する。
		const evolutionLeft = await render({ ...base, evolution: 0.999 });
		compare(await render({ ...base, evolution: 1.001 }), colors(evolutionLeft), 'evolution is continuous across integer steps');
		changed(await render({ ...base, evolution: 0.5 }), colors(globalResult), 'evolution changes the pattern smoothly');
		compare(await render(base), colors(globalResult), 'returning to an earlier evolution reproduces the image');

		// 【Mirrorでは反射拡張した全領域を変換して元の範囲を切り出す】
		// 単にサンプラーを反射にするだけでFFT領域を拡張しない実装を直接DFTで検出する。
		const mirroredPixels = Array.from({ length: 1024 }, (_, index) => {
			const x = index % 32;
			const y = Math.floor(index / 32);
			return sourcePixels[(y < 16 ? y : 31 - y) * 16 + (x < 16 ? x : 31 - x)];
		});
		const mirroredReference = directReference(mirroredPixels, 32, 32, {}, [0.5, 0.5]);
		const croppedReference = Array.from({ length: 256 }, (_, index) => mirroredReference[Math.floor(index / 16) * 32 + index % 16]);
		compare(await render({ ...base, boundary: 'mirror' }), croppedReference, 'mirrored global extension agrees with direct DFT');

		// 【非正方形の両軸を別々のFFT長で変換し、周波数を等方的に扱う】
		// 短辺を長辺へ引き伸ばして帯域を選ぶ誤りと、行列で異なるbit数を使う経路を確認する。
		const rectanglePixels: Color[] = Array.from({ length: 512 }, (_, index) => {
			const x = index % 32;
			const y = Math.floor(index / 32);
			const value = 0.5 + 0.2 * Math.cos(2 * Math.PI * (x + 0.5) / 16) + 0.15 * Math.cos(2 * Math.PI * (y + 0.5) / 16);
			return gray(value);
		});
		const rectangleInput = texture(32, 16, rectanglePixels);
		const rectangleRender = createEffect(32, 16);
		const rectangleBase: Partial<Parameters> = { input: rectangleInput, analysisResolution: '32', minFrequency: 2, maxFrequency: 2 };
		compare(await rectangleRender(rectangleBase), directReference(quantized(rectanglePixels), 32, 16, rectangleBase, [1, 2]), 'rectangular FFT and isotropic frequency band agree with DFT');
		compare(await rectangleRender({ ...rectangleBase, sizeReference: 'height', minFrequency: 1, maxFrequency: 1 }), colors(await rectangleRender(rectangleBase)), 'size reference converts cycles without changing the physical band');
		compare(await render({ ...base, minFrequency: 4, maxFrequency: 1 }), colors(await render({ ...base, minFrequency: 1, maxFrequency: 4 })), 'reversed frequency bounds use the same band');

		// 【Blocksの50%重なりとHann合成を既知の正弦波の解析解と照合する】
		// FFT係数の近似でなく、ブロックごとの正弦波の位相と四つの窓だけから期待値を求める。
		const wavePixels = Array.from({ length: 512 }, (_, index) => gray(0.5 + 0.25 * Math.cos(2 * Math.PI * ((index % 32) + 0.5) / 16)));
		const waveInput = texture(32, 16, wavePixels);
		const blocksBase: Partial<Parameters> = { input: waveInput, processing: 'blocks', blockSize: 50, minFrequency: 2, maxFrequency: 2 };
		const blocksReference = quantized(wavePixels).map((pixel, index) => {
			const x = index % 32 + 0.5;
			const y = Math.floor(index / 32) + 0.5;
			const theta = 2 * Math.PI * x / 16;
			let delta = 0;
			for (let dy = 0; dy < 2; dy++) {
				for (let dx = 0; dx < 2; dx++) {
					const bx = Math.floor(x / 8) + dx;
					const by = Math.floor(y / 8) + dy;
					const localX = (x - (bx - 1) * 8) / 16;
					const localY = (y - (by - 1) * 8) / 16;
					const weight = Math.sin(Math.PI * localX) ** 2 * Math.sin(Math.PI * localY) ** 2;
					const phase = phaseOffset(1, by * 5 + bx, 0, 0, 0) * defaults.amount;
					delta += 0.25 * (Math.cos(theta + phase) - Math.cos(theta)) * weight;
				}
			}
			return [pixel[0] + delta, pixel[1] + delta, pixel[2] + delta, 1] as Color;
		});
		const blocksResult = await rectangleRender(blocksBase);
		compare(blocksResult, blocksReference, 'overlapping blocks agree with analytic sinusoid and Hann windows');
		compare(await rectangleRender({ ...blocksBase, boundary: 'mirror' }), colors(await rectangleRender({ ...blocksBase, boundary: 'mirror' })), 'mirrored blocks remain deterministic at the canvas edges');
		compare(await rectangleRender(rectangleBase), directReference(quantized(rectanglePixels), 32, 16, rectangleBase, [1, 2]), 'global processing recovers after changing block layout');

		// 【RGB Linkedはチャンネル間の相対位相を保ち、Independentは別々の位相を使う】
		// 灰色入力で色ずれが生じる設定と生じない設定を同じinstanceで比較する。
		compare(blocksResult, colors(blocksResult).map(pixel => [pixel[0], pixel[0], pixel[0], 1]), 'linked RGB keeps grayscale blocks achromatic');
		const independent = await rectangleRender({ ...blocksBase, channelMode: 'independent' });
		if (!(colors(independent).some(pixel => Math.abs(pixel[0] - pixel[1]) > 0.01))) throw new Error('Independent channels did not separate');
		checks.push('independent RGB produces channel-specific phases');

		// 【透明度を固定し、透明領域へ色を漏らさず、HDRと負の値を飽和させない】
		// 乗算済みRGBの元値までalphaを再乗算する誤りと、最終出力の無条件clampを防ぐ。
		const alphaPixels: Color[] = sourcePixels.map((pixel, index) => {
			const alpha = index % 16 >= 8 ? 0 : Math.floor(index / 16) >= 8 ? 0.25 : 1;
			return [pixel[0] * alpha, pixel[1] * alpha, pixel[2] * alpha, alpha];
		});
		const alphaInput = texture(16, 16, alphaPixels);
		for (const processing of ['global', 'blocks'] as const) {
			const actual = colors(await render({ input: alphaInput, processing }));
			actual.forEach((pixel, index) => {
				if (pixel[3] !== alphaPixels[index][3] || pixel.some(value => !Number.isFinite(value))) throw new Error('Alpha or finite RGB was not preserved');
				if (pixel[3] === 0 && pixel.some(value => value !== 0)) throw new Error('Color leaked into transparent pixels');
			});
			checks.push(processing + ' preserves alpha and masks differences in transparent regions');
			compare(await render({ input: alphaInput, processing, amount: 0 }), quantized(alphaPixels), processing + ' alpha bypass does not premultiply twice');
		}
		const hdrPixels = Array.from({ length: 256 }, (_, index) => gray(0.2 + Math.cos(2 * Math.PI * ((index % 16) + 0.5) / 16)));
		const hdrResult = colors(await render({ input: texture(16, 16, hdrPixels) }));
		if (!(hdrResult.some(pixel => pixel[0] < 0) && hdrResult.some(pixel => pixel[0] > 1))) throw new Error('HDR or negative values were clamped');
		checks.push('HDR and negative RGB remain unclamped');

		// 【出力解像度を変えても同じ画面座標で同じ解析差分を得る】
		// 3倍の出力では元画素中心と一致する中央画素を抜き出し、補間による評価位置の差を除く。
		const largerRender = createEffect(48, 48);
		const larger = await largerRender(base);
		const matchingCenters = new Float32Array(sourcePixels.length * 4);
		for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) matchingCenters.set(larger.subarray(((y * 3 + 1) * 48 + x * 3 + 1) * 4, ((y * 3 + 1) * 48 + x * 3 + 1) * 4 + 4), (y * 16 + x) * 4);
		compare(matchingCenters, colors(globalResult), 'global analysis is independent of output resolution');
		const largerBlocksRender = createEffect(96, 48);
		const largerBlocks = await largerBlocksRender(blocksBase);
		const blockCenters = new Float32Array(wavePixels.length * 4);
		for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) blockCenters.set(largerBlocks.subarray(((y * 3 + 1) * 96 + x * 3 + 1) * 4, ((y * 3 + 1) * 96 + x * 3 + 1) * 4 + 4), (y * 32 + x) * 4);
		compare(blockCenters, colors(blocksResult), 'block size and analysis are independent of output resolution');

		// 【GPU上限を超えるブロック格子や不正な寸法は実行前に拒否する】
		// プレビューと書き出しで精度を自動変更せず、過大なbufferやdispatchを防ぐ。
		for (const blockSize of [0, -1, NaN, 0.001]) {
			let rejected = false;
			try { await render({ ...base, processing: 'blocks', blockSize, blockResolution: '128' }); } catch (error) { rejected = error instanceof Error && error.message.startsWith('Phase Scramble:'); }
			if (!rejected) throw new Error('Invalid or oversized block layout was not rejected');
			checks.push('invalid or oversized block size ' + blockSize + ' is rejected');
		}
		compare(await render({ ...base, amount: NaN, minFrequency: NaN, maxFrequency: NaN, softness: NaN, seed: NaN, evolution: NaN }), colors(await render({ ...base, amount: 0.5, minFrequency: 2, maxFrequency: 64, softness: 2 })), 'nonfinite controls use finite defaults');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
