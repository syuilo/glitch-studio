import { audioChannel, finiteNumber } from '@gs/shared/utility/audio-spectrum.js';
import { AudioInputSpectrum } from '@gs/subsystems_audio_renderer/audio-input-spectrum.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createAudioWindowLoader } from '../../audio-window-loader.ts';
import shader from './shader.wgsl?raw';
import type { SpectrumAnalysisRequest } from '@gs/subsystems_audio_renderer/audio-input-spectrum.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	disableCache: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution, reportStatus }) => {
		const loader = createAudioWindowLoader(reportStatus);
		const columns = Math.max(2, Math.min(2048, resolution.width));
		const device = wgpu.device;
		const module = device.createShaderModule({ code: shader });
		const pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module, targets: [{ format: wgpu.intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniformBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const dataBuffer = device.createBuffer({ size: columns * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const data = new Float32Array(columns * 4);
		const uniforms = new Float32Array(12);
		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: dataBuffer } },
			],
		});
		let spectrum = new AudioInputSpectrum(2048);
		let request: SpectrumAnalysisRequest | null = null;
		let requestKey: string | undefined;
		const prepare = (params: RuntimeEffectParameters<typeof definition.paramDefs>, signal?: AbortSignal) => {
			const size = 2 ** Math.round(Math.log2(finiteNumber(Number(params.fftSize), 2048, 256, 32768)));
			const key = JSON.stringify([params.audio?.cacheKey ?? null, size, params.channel, params.window]);
			if (key !== requestKey) {
				if (spectrum.size !== size) spectrum = new AudioInputSpectrum(size);
				request = params.audio ? spectrum.plan(params.audio, audioChannel(params.channel), params.window) : null;
				requestKey = key;
			}
			loader.prepare(request?.input ?? null, request?.durationSeconds ?? 1, signal);
		};
		return {
			get cacheVersion() { return loader.revision; },
			prepare,
			render(ctx) {
				const { params } = ctx;
				// LIVEでは同期取得、Timelineではprepareで待機した窓を使う。
				prepare(params);
				const channel = audioChannel(params.channel);
				if (request && loader.window) spectrum.update(request, loader.window, finiteNumber(params.smoothing, 0.15, 0, 2));
				if (!params.audio) spectrum.disconnect();
				const visible = params.audio != null && spectrum.hasData && (!request || loader.window != null);
				const size = spectrum.size;
				data.fill(0);
				if (params.audio && visible) {
					const nyquist = params.audio.sampleRate / 2;
					const minFrequency = finiteNumber(params.minFrequency, 20, params.logarithmic ? 1 : 0, nyquist - 1);
					const maxFrequency = finiteNumber(params.maxFrequency, 20000, minFrequency + 1, nyquist);
					const minDb = finiteNumber(params.minDb, -80, -120, -1);
					const maxDb = finiteNumber(params.maxDb, 0, minDb + 1, 20);
					const frequency = (x: number) => params.logarithmic
						? minFrequency * (maxFrequency / minFrequency) ** x
						: minFrequency + (maxFrequency - minFrequency) * x;
					for (let x = 0; x < columns; x++) {
						const from = frequency(x / columns) * size / params.audio.sampleRate;
						const to = frequency((x + 1) / columns) * size / params.audio.sampleRate;
						for (let side = 0; side < (channel === 'stereo' ? 2 : 1); side++) {
							const values = side === 0 ? spectrum.left : spectrum.right;
							let amplitude = 0;
							if (to - from < 1) {
								const position = (from + to) * 0.5;
								const index = Math.floor(position);
								const mix = position - index;
								amplitude = values[index] * (1 - mix) + values[Math.min(index + 1, size / 2)] * mix;
							} else {
								for (let bin = Math.ceil(from); bin <= Math.min(size / 2, Math.floor(to)); bin++) amplitude = Math.max(amplitude, values[bin]);
							}
							const db = 20 * Math.log10(Math.max(amplitude, 1e-12));
							data[x * 4 + side * 2 + 1] = Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
						}
					}
				}
				uniforms.set([
					...params.color,
					...params.rightColor,
					columns, Number(channel === 'stereo'), Number(visible), 0,
				]);
				device.queue.writeBuffer(uniformBuffer, 0, uniforms);
				device.queue.writeBuffer(dataBuffer, 0, data);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose() {
				loader.dispose();
				uniformBuffer.destroy();
				dataBuffer.destroy();
			},
		};
	},
});
