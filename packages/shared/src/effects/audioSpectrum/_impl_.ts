import { audioChannel, AudioSpectrum, finiteNumber } from '@glitch/shared/utility/audio-spectrum.js';
import { implementEffect } from '../../effect-implementation.ts';
import shader from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	disableCache: true,
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu, resolution }) => {
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
		let spectrum: AudioSpectrum | null = null;
		return {
			render(ctx) {
				const { params } = ctx;
				const size = 2 ** Math.round(Math.log2(finiteNumber(params.fftSize, 2048, 256, 32768)));
				if (!spectrum || spectrum.size !== size || spectrum.windowName !== params.window) spectrum = new AudioSpectrum(size, params.window);
				const history = params.player?.audio ?? null;
				const channel = audioChannel(params.channel);
				spectrum.update(history, channel, finiteNumber(params.smoothing, 0.15, 0, 2));
				data.fill(0);
				if (history && spectrum.hasData) {
					const nyquist = history.sampleRate / 2;
					const minFrequency = finiteNumber(params.minFrequency, 20, params.logarithmic ? 1 : 0, nyquist - 1);
					const maxFrequency = finiteNumber(params.maxFrequency, 20000, minFrequency + 1, nyquist);
					const minDb = finiteNumber(params.minDb, -80, -120, -1);
					const maxDb = finiteNumber(params.maxDb, 0, minDb + 1, 20);
					const frequency = (x: number) => params.logarithmic
						? minFrequency * (maxFrequency / minFrequency) ** x
						: minFrequency + (maxFrequency - minFrequency) * x;
					for (let x = 0; x < columns; x++) {
						const from = frequency(x / columns) * size / history.sampleRate;
						const to = frequency((x + 1) / columns) * size / history.sampleRate;
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
					params.color[0], params.color[1], params.color[2], 1,
					params.rightColor[0], params.rightColor[1], params.rightColor[2], 1,
					columns, Number(channel === 'stereo'), Number(spectrum.hasData), 0,
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
				uniformBuffer.destroy();
				dataBuffer.destroy();
			},
		};
	},
});
