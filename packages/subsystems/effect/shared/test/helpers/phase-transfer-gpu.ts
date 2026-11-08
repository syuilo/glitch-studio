import definition from '../../src/fx/phaseTransfer/_def_.ts';
import implementation from '../../src/fx/phaseTransfer/_impl_.ts';
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
		reference: constantShaderInput('color', [0, 0, 0, 0]), phaseThreshold: 0.00001, channelMode: 'linked', boundary: 'repeat', analysisResolution: '16', blockSize: 50, blockResolution: '16', sizeReference: 'longSide',
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
	}	function directSpectrum(pixels: Color[], width: number, height: number) {
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

	function directReference(inputPixels: Color[], referencePixels: Color[], width: number, height: number, overrides: Partial<Parameters> = {}, frequencyScale: [number, number] = [1, 1]): Color[] {
		const params = { ...defaults, ...overrides };
		const inputSpectrum = directSpectrum(inputPixels, width, height);
		const referenceSpectrum = directSpectrum(referencePixels, width, height);
		const delta = new Float64Array(inputSpectrum.length);
		const complex = (spectrum: Float64Array, frequency: number, channel: number) => {
			if (params.channelMode === 'independent') return [spectrum[frequency * 6 + channel], spectrum[frequency * 6 + channel + 3]];
			return [0.2126 * spectrum[frequency * 6] + 0.7152 * spectrum[frequency * 6 + 1] + 0.0722 * spectrum[frequency * 6 + 2],
				0.2126 * spectrum[frequency * 6 + 3] + 0.7152 * spectrum[frequency * 6 + 4] + 0.0722 * spectrum[frequency * 6 + 5]];
		};
		for (let frequency = 0; frequency < width * height; frequency++) {
			const x = frequency % width;
			const y = Math.floor(frequency / width);
			const partner = ((height - y) % height) * width + (width - x) % width;
			if (frequency === partner) continue;
			const radial = Math.hypot((x > width / 2 ? x - width : x) * frequencyScale[0], (y > height / 2 ? y - height : y) * frequencyScale[1]);
			let weight = radial >= params.minFrequency && radial <= params.maxFrequency ? 1 : 0;
			if (params.softness > 0) {
				const smooth = (center: number) => {
					const value = Math.max(0, Math.min(1, (radial - center + params.softness) / (2 * params.softness)));
					return value * value * (3 - 2 * value);
				};
				weight = (params.minFrequency > 0 ? smooth(params.minFrequency) : 1) * (1 - smooth(params.maxFrequency));
			}
			for (let channel = 0; channel < 3; channel++) {
				const input = complex(inputSpectrum, Math.min(frequency, partner), channel);
				const reference = complex(referenceSpectrum, Math.min(frequency, partner), channel);
				const amplitude = Math.hypot(...input);
				const referenceAmplitude = Math.hypot(...reference);
				if (amplitude / inputPixels.length <= params.phaseThreshold || referenceAmplitude / inputPixels.length <= params.phaseThreshold) continue;
				const real = (reference[0] * input[0] + reference[1] * input[1]) / (amplitude * referenceAmplitude);
				const imaginary = (reference[1] * input[0] - reference[0] * input[1]) / (amplitude * referenceAmplitude);
				const principalPhase = Math.atan2(imaginary, real);
				const phase = principalPhase < -Math.PI + 0.001 ? principalPhase + 2 * Math.PI : principalPhase;
				const angle = phase * params.amount * weight * (frequency < partner ? 1 : -1);
				const cosine = Math.cos(angle) - 1;
				const sine = Math.sin(angle);
				const sourceReal = inputSpectrum[frequency * 6 + channel];
				const sourceImaginary = inputSpectrum[frequency * 6 + channel + 3];
				delta[frequency * 6 + channel] = sourceReal * cosine - sourceImaginary * sine;
				delta[frequency * 6 + channel + 3] = sourceReal * sine + sourceImaginary * cosine;
			}
		}
		return inputPixels.map((pixel, index) => {
			if (pixel[3] <= 0) return [0, 0, 0, 0];
			const output: Color = [...pixel];
			for (let frequency = 0; frequency < width * height; frequency++) {
				const angle = 2 * Math.PI * ((frequency % width) * (index % width) / width + Math.floor(frequency / width) * Math.floor(index / width) / height);
				for (let channel = 0; channel < 3; channel++) output[channel] += (delta[frequency * 6 + channel] * Math.cos(angle) - delta[frequency * 6 + channel + 3] * Math.sin(angle)) / inputPixels.length * pixel[3];
			}
			return output;
		});
	}

	try {
		const sourcePixels: Color[] = Array.from({ length: 256 }, (_, index) => {
			const x = index % 16;
			const y = Math.floor(index / 16);
			return [0.5 + 0.2 * Math.cos(2 * Math.PI * (2 * x + 3 * y) / 16) + 0.05 * Math.cos(2 * Math.PI * x / 16),
				0.4 + 0.12 * Math.sin(2 * Math.PI * (x - y) / 16),
				0.3 + 0.1 * Math.cos(2 * Math.PI * (2 * x + 3 * y) / 16 + 0.5), 1];
		});
		const referencePixels: Color[] = Array.from({ length: 256 }, (_, index) => {
			const x = index % 16;
			const y = Math.floor(index / 16);
			return [0.3 + 0.1 * Math.cos(2 * Math.PI * (2 * x + 3 * y) / 16 + 1) + 0.03 * Math.cos(2 * Math.PI * x / 16 - 0.7),
				0.6 + 0.25 * Math.sin(2 * Math.PI * (x - y) / 16 + 0.6),
				0.5 + 0.18 * Math.cos(2 * Math.PI * (2 * x + 3 * y) / 16 - 1.2), 1];
		});
		const source = quantized(sourcePixels);
		const referenceSource = quantized(referencePixels);
		const input = texture(16, 16, sourcePixels);
		const reference = texture(16, 16, referencePixels);
		const render = createEffect(16, 16);
		const base: Partial<Parameters> = { input, reference };

		// 【両入力のFFTと最短角度差の位相補間を、CPUの直接DFTと照合する】
		// 二つ目のFFTで主入力のbufferを上書きする誤りや、副入力の振幅まで移す処理を検出する。
		const linked = await render(base);
		compare(linked, directReference(source, referenceSource, 16, 16), 'linked phase transfer agrees with direct DFT');
		const independent = await render({ ...base, channelMode: 'independent' });
		compare(independent, directReference(source, referenceSource, 16, 16, { channelMode: 'independent' }), 'independent RGB phase transfer agrees with direct DFT');
		compare(await render({ ...base, minFrequency: 1, maxFrequency: 4, softness: 0.75 }), directReference(source, referenceSource, 16, 16, { minFrequency: 1, maxFrequency: 4, softness: 0.75 }), 'soft phase transfer band agrees with direct DFT');
		changed(linked, source, 'reference phases change input structure');

		// 【移植量1では主入力の振幅と副入力の位相を組み合わせる】
		// 不透明・等倍・Repeatの全係数を調べ、通常の画像クロスフェードや係数の線形混合を防ぐ。
		const full = await render({ ...base, amount: 1, channelMode: 'independent' });
		compare(full, directReference(source, referenceSource, 16, 16, { amount: 1, channelMode: 'independent' }), 'full phase transfer agrees with direct DFT');
		const originalSpectrum = directSpectrum(source, 16, 16);
		const resultSpectrum = directSpectrum(colors(full), 16, 16);
		const targetSpectrum = directSpectrum(referenceSource, 16, 16);
		for (let frequency = 0; frequency < 256; frequency++) {
			const x = frequency % 16;
			const y = Math.floor(frequency / 16);
			const selfConjugate = (x === 0 || x === 8) && (y === 0 || y === 8);
			for (let channel = 0; channel < 3; channel++) {
				const offset = frequency * 6 + channel;
				const before = Math.hypot(originalSpectrum[offset], originalSpectrum[offset + 3]);
				const after = Math.hypot(resultSpectrum[offset], resultSpectrum[offset + 3]);
				if (Math.abs(before - after) / 256 > 0.0005) throw new Error('Input spectral magnitude changed');
				const target = Math.hypot(targetSpectrum[offset], targetSpectrum[offset + 3]);
				if (!selfConjugate && before / 256 > 0.005 && target / 256 > 0.005) {
					const crossReal = resultSpectrum[offset] * targetSpectrum[offset] + resultSpectrum[offset + 3] * targetSpectrum[offset + 3];
					const crossImaginary = resultSpectrum[offset + 3] * targetSpectrum[offset] - resultSpectrum[offset] * targetSpectrum[offset + 3];
					if (Math.abs(Math.atan2(crossImaginary, crossReal)) > 0.005) throw new Error('Reference phase was not adopted');
				}
			}
		}
		checks.push('full transfer retains input magnitudes and adopts reference phases');

		// 【Global・Blocksのバイパス、未接続・一様・透明な副入力を正しく扱う】
		// 位相のない副入力が黒化や位相0への強制を起こさず、主入力のRGBAを保持することを確認する。
		for (const processing of ['global', 'blocks'] as const) {
			compare(await render({ ...base, processing, amount: 0 }), source, processing + ' zero amount preserves the input');
			compare(await render({ ...base, processing, minFrequency: 100000, maxFrequency: 100001 }), source, processing + ' excluded band adds no difference');
			compare(await render({ ...base, processing, reference: input }), source, processing + ' self reference is unchanged');
			compare(await render({ ...base, processing, reference: constantShaderInput('color', [0, 0, 0, 0]) }), source, processing + ' unconnected reference preserves input');
			compare(await render({ ...base, processing, reference: constantShaderInput('color', [1, 0.5, 0.25, 1]) }), source, processing + ' constant reference preserves input');
			compare(await render({ ...base, processing, reference: texture(16, 16, Array.from({ length: 256 }, () => gray(0.5))) }), source, processing + ' constant reference texture has no usable non-DC phase');
			compare(await render({ ...base, processing, reference: texture(16, 16, Array.from({ length: 256 }, () => gray(0, 0))) }), source, processing + ' transparent reference texture has no usable phase');
			const constant = constantShaderInput('color', [0.5, 0.25, 1, 0.5]);
			compare(await render({ ...base, processing, input: constant }), Array.from({ length: 256 }, () => [0.25, 0.125, 0.5, 0.5] as Color), processing + ' constant input is premultiplied once');
			compare(await render({ ...base, processing, phaseThreshold: 1 }), source, processing + ' weak phase amplitudes retain source phase');
			const first = await render({ ...base, processing });
			changed(first, source, processing + ' transfers actual image structure');
			compare(await render({ ...base, processing }, 100), colors(first), processing + ' is independent of time and earlier input variants');
		}

		// 【RGB Linkedは主入力の相対位相を保ち、Independentは各色の参照位相を使う】
		// 灰色入力と異なる位相を持つRGB参照により、LinkedがRだけを基準にする誤りを検出する。
		const grayPixels = source.map(pixel => gray(pixel[0]));
		const grayInput = texture(16, 16, grayPixels);
		const linkedGray = await render({ ...base, input: grayInput });
		compare(linkedGray, colors(linkedGray).map(pixel => gray(pixel[0])), 'linked luminance phase keeps grayscale input achromatic');
		const separateGray = colors(await render({ ...base, input: grayInput, channelMode: 'independent' }));
		if (!(separateGray.some(pixel => Math.abs(pixel[0] - pixel[2]) > 0.01))) throw new Error('Independent reference channels did not separate');
		checks.push('independent reference phases produce channel-specific structure');

		// 【180°の位相差でも共役対を壊さず、途中のAmountで振幅を落とさない】
		// 正反対の係数を線形混合するとAmount=0.5で消えるため、正弦波の解析解と比較する。
		const wave = Array.from({ length: 256 }, (_, index) => gray(0.5 + 0.25 * Math.cos(2 * Math.PI * ((index % 16) + 0.5) / 16)));
		const opposite = Array.from({ length: 256 }, (_, index) => gray(0.5 - 0.25 * Math.cos(2 * Math.PI * ((index % 16) + 0.5) / 16)));
		const halfTurn = await render({ input: texture(16, 16, wave), reference: texture(16, 16, opposite), minFrequency: 1, maxFrequency: 1, amount: 0.5 });
		compare(halfTurn, Array.from({ length: 256 }, (_, index) => gray(0.5 + 0.25 * Math.cos(2 * Math.PI * ((index % 16) + 0.5) / 16 + Math.PI / 2))), 'half-turn phase interpolation follows a unit circle');

		// 【反射拡張と、行列のFFT段数の奇偶が異なる長方形を直接DFTで照合する】
		// 三つのbufferを再利用しても主入力のスペクトルを保持し、元領域を正しく切り出す。
		const mirrored = (pixels: Color[]) => Array.from({ length: 1024 }, (_, index) => {
			const x = index % 32;
			const y = Math.floor(index / 32);
			return pixels[(y < 16 ? y : 31 - y) * 16 + (x < 16 ? x : 31 - x)];
		});
		const mirrorReference = directReference(mirrored(source), mirrored(referenceSource), 32, 32, {}, [0.5, 0.5]);
		compare(await render({ ...base, boundary: 'mirror' }), Array.from({ length: 256 }, (_, index) => mirrorReference[Math.floor(index / 16) * 32 + index % 16]), 'mirrored transfer agrees with extended-domain DFT');
		const rectangleInputPixels = Array.from({ length: 512 }, (_, index) => gray(0.5 + 0.2 * Math.cos(2 * Math.PI * ((index % 32) + 0.5) / 16) + 0.1 * Math.cos(2 * Math.PI * (Math.floor(index / 32) + 0.5) / 16)));
		const rectangleReferencePixels = Array.from({ length: 512 }, (_, index) => gray(0.4 + 0.1 * Math.cos(2 * Math.PI * ((index % 32) + 0.5) / 16 + 0.7) + 0.2 * Math.cos(2 * Math.PI * (Math.floor(index / 32) + 0.5) / 16 - 0.4)));
		const rectangleRender = createEffect(32, 16);
		const rectangleBase: Partial<Parameters> = { input: texture(32, 16, rectangleInputPixels), reference: texture(32, 16, rectangleReferencePixels), analysisResolution: '32', minFrequency: 2, maxFrequency: 2 };
		const rectangleResult = await rectangleRender(rectangleBase);
		compare(rectangleResult, directReference(quantized(rectangleInputPixels), quantized(rectangleReferencePixels), 32, 16, rectangleBase, [1, 2]), 'rectangular transfer handles odd FFT stage counts and isotropic frequencies');
		compare(await rectangleRender({ ...rectangleBase, sizeReference: 'height', minFrequency: 1, maxFrequency: 1 }), colors(rectangleResult), 'reference size converts cycles without changing the band');
		compare(await render({ ...base, minFrequency: 4, maxFrequency: 1 }), colors(await render({ ...base, minFrequency: 1, maxFrequency: 4 })), 'reversed frequency bounds preserve the selected band');

		// 【副入力の解像度とFitを主入力から独立に適用する】
		// 小さい参照を画素番号で直接読む実装や、containの透明余白を無視する処理を防ぐ。
		const smallReference = referenceSource.filter((_, index) => index % 16 % 2 === 0 && Math.floor(index / 16) % 2 === 0);
		const expandedReference = Array.from({ length: 256 }, (_, index) => smallReference[Math.floor(Math.floor(index / 16) / 2) * 8 + Math.floor((index % 16) / 2)]);
		compare(await render({ ...base, reference: texture(8, 8, smallReference) }), directReference(source, expandedReference, 16, 16), 'reference resolution is fitted independently');
		const narrowReference = referenceSource.filter((_, index) => index % 16 < 8);
		const containedReference = Array.from({ length: 256 }, (_, index) => index % 16 < 4 || index % 16 >= 12 ? gray(0, 0) : narrowReference[Math.floor(index / 16) * 8 + index % 16 - 4]);
		compare(await render({ ...base, reference: texture(8, 16, narrowReference, { fitMode: 'contain', wrapMode: 'transparent' }) }), directReference(source, containedReference, 16, 16), 'reference contain fit includes transparent margins');

		// 【Blocksの異なる局所位相とHann合成を、正弦波の解析解で検証する】
		// 副入力のY方向の変化によりブロックごとの位相を変え、全体FFTの代用や窓の対応ミスを検出する。
		const blockSource = Array.from({ length: 1024 }, (_, index) => gray(0.5 + 0.25 * Math.cos(2 * Math.PI * ((index % 32) + 0.5) / 16)));
		const blockReference = Array.from({ length: 1024 }, (_, index) => {
			const theta = 2 * Math.PI * ((index % 32) + 0.5) / 16;
			return gray(0.5 + 0.1 * Math.cos(theta) - 0.1 * ((Math.floor(index / 32) + 0.5) / 32) * Math.sin(theta));
		});
		const blocksRender = createEffect(32, 32);
		const blocksBase: Partial<Parameters> = { input: texture(32, 32, blockSource), reference: texture(32, 32, blockReference), processing: 'blocks', blockSize: 50, minFrequency: 2, maxFrequency: 2, amount: 0.5 };
		const expectedBlocks = quantized(blockSource).map((pixel, index) => {
			const x = index % 32 + 0.5;
			const y = Math.floor(index / 32) + 0.5;
			const theta = 2 * Math.PI * x / 16;
			let delta = 0;
			for (let dy = 0; dy < 2; dy++) {
				for (let dx = 0; dx < 2; dx++) {
					const bx = Math.floor(x / 8) + dx;
					const by = Math.floor(y / 8) + dy;
					let meanY = 0;
					for (let row = 0; row < 16; row++) meanY += (((by - 1) * 8 + row + 32) % 32 + 0.5) / (32 * 16);
					const phase = Math.atan(meanY) * 0.5;
					const weight = Math.sin(Math.PI * (x - (bx - 1) * 8) / 16) ** 2 * Math.sin(Math.PI * (y - (by - 1) * 8) / 16) ** 2;
					delta += 0.25 * (Math.cos(theta + phase) - Math.cos(theta)) * weight;
				}
			}
			return [pixel[0] + delta, pixel[1] + delta, pixel[2] + delta, 1] as Color;
		});
		const blocksResult = await blocksRender(blocksBase);
		compare(blocksResult, expectedBlocks, 'local reference phases and Hann overlap agree with an analytic wave');
		const mirroredBlocks = await blocksRender({ ...blocksBase, boundary: 'mirror' });
		compare(await blocksRender({ ...blocksBase, boundary: 'mirror' }, 100), colors(mirroredBlocks), 'mirrored local transfer is deterministic at canvas edges');
		compare(await render(base), colors(linked), 'global transfer is restored after mode and reference changes');

		// 【主入力のalphaを固定し、透明な副入力の位相や隠れた色で不正な値を作らない】
		// 元RGBの二重premultiply、透明領域への漏れ、参照マスクで主入力alphaを置換する誤りを防ぐ。
		const alphaPixels: Color[] = source.map((pixel, index) => {
			const alpha = index % 16 >= 8 ? 0 : Math.floor(index / 16) >= 8 ? 0.25 : 1;
			return [pixel[0] * alpha, pixel[1] * alpha, pixel[2] * alpha, alpha];
		});
		const alphaInput = texture(16, 16, alphaPixels);
		for (const processing of ['global', 'blocks'] as const) {
			const alphaResult = colors(await render({ ...base, input: alphaInput, processing }));
			alphaResult.forEach((pixel, index) => {
				if (pixel[3] !== alphaPixels[index][3] || pixel.some(value => !Number.isFinite(value))) throw new Error('Input alpha was not retained');
				if (pixel[3] === 0 && pixel.some(value => value !== 0)) throw new Error('Color leaked into transparent input');
			});
			checks.push(processing + ' transfer retains primary alpha without transparent leaks');
			compare(await render({ ...base, input: alphaInput, processing, amount: 0 }), quantized(alphaPixels), processing + ' alpha bypass preserves premultiplied input');
		}
		const transparentReference = referenceSource.map((pixel, index) => index % 16 < 8 ? [0, 0, 0, 0] as Color : pixel);
		compare(await render({ ...base, reference: texture(16, 16, transparentReference), channelMode: 'independent' }), directReference(source, transparentReference, 16, 16, { channelMode: 'independent' }), 'partial reference alpha contributes only visible premultiplied RGB');

		// 【解析格子を出力解像度から独立させ、同じ画面座標で結果を保つ】
		// 3倍出力の元画素中心と一致する位置だけを比較し、補間位置の違いを除く。
		const largerRender = createEffect(48, 48);
		const larger = await largerRender(base);
		const centers = new Float32Array(256 * 4);
		for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) centers.set(larger.subarray(((y * 3 + 1) * 48 + x * 3 + 1) * 4, ((y * 3 + 1) * 48 + x * 3 + 1) * 4 + 4), (y * 16 + x) * 4);
		compare(centers, colors(linked), 'global phase transfer is independent of output resolution');
		const largerBlocksRender = createEffect(96, 96);
		const largerBlocks = await largerBlocksRender(blocksBase);
		const blockCenters = new Float32Array(1024 * 4);
		for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) blockCenters.set(largerBlocks.subarray(((y * 3 + 1) * 96 + x * 3 + 1) * 4, ((y * 3 + 1) * 96 + x * 3 + 1) * 4 + 4), (y * 32 + x) * 4);
		compare(blockCenters, colors(blocksResult), 'block phase transfer is independent of output resolution');

		// 【GPU上限を超える配置や不正なBlock Sizeは実行前に拒否する】
		// 副入力が増えても精度を自動で変えず、危険なbuffer確保を防ぐ。
		for (const blockSize of [0, -1, NaN, 0.001]) {
			let rejected = false;
			try { await render({ ...base, processing: 'blocks', blockSize, blockResolution: '128' }); } catch (error) { rejected = error instanceof Error && error.message.startsWith('Phase Transfer:'); }
			if (!rejected) throw new Error('Invalid or oversized block layout was not rejected');
			checks.push('invalid or oversized block size ' + blockSize + ' is rejected');
		}
		compare(await render({ ...base, amount: NaN, minFrequency: NaN, maxFrequency: NaN, softness: NaN, phaseThreshold: NaN }), colors(await render({ ...base, amount: 0.5, minFrequency: 2, maxFrequency: 64, softness: 2 })), 'nonfinite phase transfer controls use finite defaults');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
