import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import { audioChannel, finiteNumber } from '@gs/subsystems_audio_renderer/audio-spectrum.ts';
import shader from './audio-spectrogram.wgsl?raw';

// 共通描画処理の設定。エフェクトのパラメータスキーマとは独立して定義する。
export type SpectrogramSettings = {
	channel: 'left' | 'right' | 'mix' | 'stereo';
	fftSize: 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384 | 32768;
	window: 'hann' | 'hamming' | 'blackman' | 'rectangular';
	smoothing: number;
	minFrequency: number;
	maxFrequency: number;
	logarithmic: boolean;
	minDb: number;
	maxDb: number;
	duration: number;
	orientation: 'horizontal' | 'vertical';
	direction: 'forward' | 'reverse';
	flipFrequency: boolean;
};

export type SpectrogramRendererOptions = {
	device: GPUDevice;
	vertexShaderModule: GPUShaderModule;
	format: GPUTextureFormat;
	enable32bitDataTextures: boolean;
};

/** 解析計画とGPU履歴が同じ設定を使うよう、読み出しを始める前に値を確定する。 */
export function resolveSpectrogramSettings(settings: SpectrogramSettings, sampleRate: number): SpectrogramSettings {
	const fftSize = 2 ** Math.round(Math.log2(finiteNumber(settings.fftSize, 2048, 256, 32768))) as SpectrogramSettings['fftSize'];
	const minFrequency = finiteNumber(settings.minFrequency, 20, settings.logarithmic ? 1 : 0, sampleRate / 2 - 1);
	const minDb = finiteNumber(settings.minDb, -80, -120, -1);
	return {
		...settings, fftSize, channel: audioChannel(settings.channel),
		smoothing: finiteNumber(settings.smoothing, 0, 0, 2),
		duration: finiteNumber(settings.duration, 10, 0.5, 60),
		minFrequency, maxFrequency: finiteNumber(settings.maxFrequency, 20000, minFrequency + 1, sampleRate / 2),
		minDb, maxDb: finiteNumber(settings.maxDb, 0, minDb + 1, 20),
	};
}

/** 軸の向きやdB範囲は保存した振幅の表示だけを変え、解析・履歴をリセットしない。 */
export function getSpectrogramHistoryKey(settings: SpectrogramSettings, sampleRate: number): string {
	return JSON.stringify([settings.fftSize, settings.window, settings.channel, settings.smoothing,
		settings.duration, sampleRate, settings.minFrequency, settings.maxFrequency, settings.logarithmic]);
}

/** 取得元を知らず、解析済みスペクトラムのGPU履歴と描画だけを所有する。 */
export function createSpectrogramRenderer(options: SpectrogramRendererOptions) {
	const bands = 512;
	const module = options.device.createShaderModule({ code: shader });
	const sampler = options.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
	const uploadRow = new Uint16Array(bands);
	const layout = options.device.createBindGroupLayout({ entries: [
		{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
	] });
	const pipeline = options.device.createRenderPipeline({
		layout: options.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
		vertex: { module: options.vertexShaderModule },
		fragment: { module, targets: [{ format: options.format }] },
		primitive: { topology: 'triangle-list' },
	});
	const uniformBuffer = options.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const uniforms = new Float32Array(12);
	const rows = [new Float32Array(bands), new Float32Array(bands)];
	let texture: GPUTexture | null = null;
	let bindGroup: GPUBindGroup | null = null;
	let capacity = 0;
	let step = 1;
	let sampleRate = 48000;
	let settings: SpectrogramSettings | null = null;
	let historyKey: string | null = null;
	// Sceneのサンプル座標は負になり得るため、未初期化を特定の数値で表さない。
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
			const key = getSpectrogramHistoryKey(nextSettings, rate);
			settings = nextSettings;
			sampleRate = rate;
			if (key === historyKey) return;
			historyKey = key;
			reset();
			const hop = settings.fftSize / 4;
			// 長い表示期間でもGPU履歴は最大4096行。複数FFTが同じ行に入る場合はピークを保持する。
			const maxRows = Math.min(4096, options.device.limits.maxTextureDimension2D);
			step = hop * Math.max(1, Math.ceil(settings.duration * rate / hop / (maxRows - 2)));
			const required = Math.ceil(settings.duration * rate / step) + 2;
			if (capacity === required) return;
			texture?.destroy();
			capacity = required;
			texture = options.device.createTexture({
				size: [bands, capacity, 2],
				format: options.enable32bitDataTextures ? 'r32float' : 'r16float',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			bindGroup = options.device.createBindGroup({ layout, entries: [
				{ binding: 2, resource: sampler },
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: texture.createView({ dimension: '2d-array' }) },
			] });
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
				for (let band = 0; band < bands; band++) {
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
		render(endFrame: number, pass: GPURenderPassEncoder, visible = true) {
			const p = settings!;
			uniforms.set([newestBucket == null ? 0 : rowIndex(newestBucket), filled, p.duration * sampleRate / step,
				newestBucket == null ? 0 : Math.max(0, (endFrame - newestBucket * step) / step),
				Number(p.orientation !== 'vertical'), Number(p.direction === 'reverse'), Number(p.flipFrequency), Number(p.channel === 'stereo'),
				p.minDb, p.maxDb, Number(visible), 0]);
			options.device.queue.writeBuffer(uniformBuffer, 0, uniforms);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup!);
			pass.draw(6);
		},
		dispose() { texture?.destroy(); uniformBuffer.destroy(); },
	};
}
