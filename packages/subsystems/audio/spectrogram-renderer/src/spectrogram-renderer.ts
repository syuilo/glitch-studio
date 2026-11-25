import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import type { SpectrogramSettings } from './spectrogram-settings.ts';
import shader from './audio-spectrogram.wgsl?raw';

export { resolveSpectrogramSettings } from './spectrogram-settings.ts';
export type { SpectrogramSettings } from './spectrogram-settings.ts';

type FrequencyHistory = 'display-bands' | 'fft-bins';

/** 左上原点で、表示全体を各軸0〜1とした範囲。 */
export type SpectrogramViewport = { x: number; y: number; width: number; height: number };

export type SpectrogramRendererOptions = {
	device: GPUDevice;
	vertexShaderModule: GPUShaderModule;
	format: GPUTextureFormat;
	enable32bitDataTextures: boolean;
	frequencyHistory?: FrequencyHistory;
};

export function getSpectrogramHistoryKey(settings: SpectrogramSettings, sampleRate: number, frequencyHistory: FrequencyHistory = 'display-bands'): string {
	const key = [settings.fftSize, settings.window, settings.channel, settings.smoothing, settings.duration, sampleRate];
	// FFTビンを保持する場合は、周波数範囲や対数軸の切り替え後も同じ履歴を参照できる。
	if (frequencyHistory === 'display-bands') key.push(settings.minFrequency, settings.maxFrequency, Number(settings.logarithmic));
	return JSON.stringify(key);
}

/** 取得元を知らず、解析済みスペクトラムのGPU履歴と描画だけを所有する。 */
export function createSpectrogramRenderer(options: SpectrogramRendererOptions) {
	const useFftBins = options.frequencyHistory === 'fft-bins';
	const module = options.device.createShaderModule({ code: shader });
	const sampler = options.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
	const layout = options.device.createBindGroupLayout({
		entries: [
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
		],
	});
	const pipeline = options.device.createRenderPipeline({
		layout: options.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
		vertex: { module: options.vertexShaderModule },
		fragment: { module, targets: [{ format: options.format }] },
		primitive: { topology: 'triangle-list' },
	});
	const uniforms = new Float32Array(20);
	const uniformBuffer = options.device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	let uploadRow = new Uint16Array(0);
	let rows = [new Float32Array(0), new Float32Array(0)];
	let texture: GPUTexture | null = null;
	let bindGroup: GPUBindGroup | null = null;
	let bands = 0;
	let layers = 0;
	let capacity = 0;
	let step = 1;
	let sampleRate = 48000;
	let settings: SpectrogramSettings | null = null;
	let historyKey: string | null = null;
	// 音声のサンプル座標は負になり得るため、未初期化を特定の数値で表さない。
	let newestBucket: number | null = null;
	let filled = 0;
	const reset = () => {
		newestBucket = null;
		filled = 0;
		rows[0].fill(0);
		rows[1].fill(0);
	};
	const rowIndex = (bucket: number) => ((bucket % capacity) + capacity) % capacity;
	return {
		configure(nextSettings: SpectrogramSettings, rate: number) {
			const key = getSpectrogramHistoryKey(nextSettings, rate, options.frequencyHistory);
			settings = nextSettings;
			sampleRate = rate;
			if (key === historyKey) return;
			historyKey = key;
			reset();
			const hop = settings.fftSize / 4;
			const dimensionLimit = options.device.limits.maxTextureDimension2D;
			const nextBands = useFftBins ? Math.min(settings.fftSize / 2 + 1, dimensionLimit) : 512;
			const nextLayers = useFftBins && settings.channel !== 'stereo' ? 1 : 2;
			// 長い表示期間でもGPU履歴は最大4096行。複数FFTが同じ行に入る場合はピークを保持する。
			// ビンを保持する場合も、大きなFFTサイズと長い履歴の組み合わせで確保量を増やしすぎない。
			const maxRowsByMemory = Math.floor(32 * 1024 * 1024 / (nextBands * nextLayers * (options.enable32bitDataTextures ? 4 : 2)));
			const maxRows = Math.min(4096, dimensionLimit, maxRowsByMemory);
			step = hop * Math.max(1, Math.ceil(settings.duration * rate / hop / (maxRows - 2)));
			const required = Math.ceil(settings.duration * rate / step) + 2;
			if (capacity === required && bands === nextBands && layers === nextLayers) return;
			if (bands !== nextBands) {
				bands = nextBands;
				rows = [new Float32Array(bands), new Float32Array(bands)];
				if (!options.enable32bitDataTextures) uploadRow = new Uint16Array(bands);
			}
			texture?.destroy();
			capacity = required;
			layers = nextLayers;
			texture = options.device.createTexture({
				size: [bands, capacity, layers],
				format: options.enable32bitDataTextures ? 'r32float' : 'r16float',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			bindGroup = options.device.createBindGroup({
				layout,
				entries: [
					{ binding: 2, resource: sampler },
					{ binding: 0, resource: { buffer: uniformBuffer } },
					{ binding: 1, resource: texture.createView({ dimension: '2d-array' }) },
				],
			});
		},
		reset,
		append(endFrame: number, left: Float32Array, right: Float32Array) {
			const p = settings!;
			const bucket = Math.floor(endFrame / step);
			if (bucket !== newestBucket) {
				// 欠落した時刻の行を古いテクスチャで埋めない。
				filled = newestBucket != null && bucket === newestBucket + 1 ? Math.min(capacity, filled + 1) : 1;
				newestBucket = bucket;
				rows[0].fill(0);
				rows[1].fill(0);
			}
			const frequency = (x: number) => p.logarithmic
				? p.minFrequency * (p.maxFrequency / p.minFrequency) ** x
				: p.minFrequency + (p.maxFrequency - p.minFrequency) * x;
			for (let side = 0; side < (p.channel === 'stereo' ? 2 : 1); side++) {
				const values = side === 0 ? left : right;
				if (useFftBins) {
					// テクスチャ幅がFFTビン数に足りない場合も、各サンプルの近傍でピークを保持する。
					for (let bin = 0; bin < values.length; bin++) {
						const band = Math.round(bin * (bands - 1) / (values.length - 1));
						rows[side][band] = Math.max(rows[side][band], values[bin]);
					}
				} else for (let band = 0; band < bands; band++) {
					const from = frequency(band / bands) * p.fftSize / sampleRate;
					const to = frequency((band + 1) / bands) * p.fftSize / sampleRate;
					let amplitude = 0;
					if (to - from < 1) {
						const position = (from + to) * 0.5;
						const index = Math.floor(position);
						amplitude = values[index] * (1 - (position - index)) + values[Math.min(index + 1, p.fftSize / 2)] * (position - index);
					} else {
						for (let bin = Math.ceil(from); bin <= Math.min(p.fftSize / 2, Math.floor(to)); bin++) amplitude = Math.max(amplitude, values[bin]);
					}
					rows[side][band] = Math.max(rows[side][band], amplitude);
				}
				if (!options.enable32bitDataTextures) {
					for (let band = 0; band < bands; band++) uploadRow[band] = float32ToFloat16Bits(rows[side][band]);
				}
				const data = options.enable32bitDataTextures ? rows[side] : uploadRow;
				options.device.queue.writeTexture({ texture: texture!, origin: [0, rowIndex(bucket), side] }, data,
					{ bytesPerRow: data.byteLength }, [bands, 1, 1]);
			}
		},
		render(endFrame: number, pass: GPURenderPassEncoder, visible = true, viewport?: SpectrogramViewport) {
			const p = settings!;
			uniforms.set([newestBucket == null ? 0 : rowIndex(newestBucket), filled, p.duration * sampleRate / step,
				newestBucket == null ? 0 : Math.max(0, (endFrame - newestBucket * step) / step),
				Number(p.orientation !== 'vertical'), Number(p.direction === 'reverse'), Number(p.flipFrequency), Number(p.channel === 'stereo'),
				p.minDb, p.maxDb, Number(visible), Number(useFftBins),
				viewport?.x ?? 0, viewport?.y ?? 0, viewport?.width ?? 1, viewport?.height ?? 1,
				2 * p.minFrequency / sampleRate, 2 * p.maxFrequency / sampleRate, Number(p.logarithmic), 0]);
			options.device.queue.writeBuffer(uniformBuffer, 0, uniforms);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup!);
			pass.draw(3);
		},
		dispose() { texture?.destroy(); uniformBuffer.destroy(); },
	};
}
