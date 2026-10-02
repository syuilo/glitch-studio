import { audioChannel, finiteNumber } from '@glitch/shared/utility/audio-spectrum.js';
import { implementEffect } from '../../effect-implementation.ts';
import shader from './shader.wgsl?raw';
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
	init: ({ wgpu, resolution }) => {
		const columns = Math.max(2, Math.min(4096, resolution.width));
		const device = wgpu.device;
		const module = device.createShaderModule({ code: shader });
		const pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module, targets: [{ format: wgpu.intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const dataBuffer = device.createBuffer({ size: columns * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const data = new Float32Array(columns * 4);
		const uniforms = new Float32Array(16);
		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: dataBuffer } },
			],
		});
		return {
			render(ctx) {
				const { params } = ctx;
				const history = params.player?.audio;
				const channel = audioChannel(params.channel);
				const duration = finiteNumber(params.duration, 0.05, 0.005, 1);
				const amplitude = finiteNumber(params.amplitude, 1, 0, 10);
				data.fill(0);
				if (history?.channelCount) {
					const frames = Math.max(2, Math.round(duration * history.sampleRate));
					const start = history.endFrame - frames;
					for (let x = 0; x < columns; x++) {
						for (let side = 0; side < (channel === 'stereo' ? 2 : 1); side++) {
							const selected = channel === 'stereo' ? (side === 0 ? 'left' : 'right') : channel;
							let min = Infinity;
							let max = -Infinity;
							if (frames < columns) {
								const position = start + x / (columns - 1) * (frames - 1);
								const frame = Math.floor(position);
								const mix = position - frame;
								min = max = history.sample(frame, selected) * (1 - mix) + history.sample(frame + 1, selected) * mix;
							} else {
								// 単純な間引きでは消える短いピークをmin/maxで保持する。
								const from = start + Math.floor(x * frames / columns);
								const to = start + Math.floor((x + 1) * frames / columns);
								for (let frame = from; frame < to; frame++) {
									const sample = history.sample(frame, selected);
									min = Math.min(min, sample);
									max = Math.max(max, sample);
								}
							}
							data[x * 4 + side * 2] = min * amplitude;
							data[x * 4 + side * 2 + 1] = max * amplitude;
						}
					}
				}
				uniforms.set([
					params.colorL[0], params.colorL[1], params.colorL[2], 1,
					params.colorR[0], params.colorR[1], params.colorR[2], 1,
					columns, Number(channel === 'stereo'), finiteNumber(params.lineWidth, 0.003, 0.001, 0.05), resolution.width / resolution.height,
					Number(!!history?.channelCount), 0, 0, 0,
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
