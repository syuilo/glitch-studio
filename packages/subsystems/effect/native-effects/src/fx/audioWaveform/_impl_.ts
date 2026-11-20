import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { finiteNumber } from '@gs/subsystems_audio_renderer/audio-spectrum.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import { createAudioWindowReader } from '../../audio-window.ts';
import shader from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const loader = createAudioWindowReader();
		const columns = Math.max(2, Math.min(4096, resolution.width));
		const module = device.createShaderModule({ code: shader });
		const pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniformBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const dataBuffer = device.createBuffer({ size: columns * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const data = new Float32Array(columns * 2);
		const uniforms = new Float32Array(8);
		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: dataBuffer } },
			],
		});
		return {
			cacheKey: 0,
			prepare(_frame, signal) {
				return loader.prepare(params.audio, finiteNumber(params.duration, 0.05, 0.005, 1), signal);
			},
			render(ctx) {
				const audioWindow = loader.window;
				// Stereoも左右を混ぜた1本の波形にし、従来のMixと同じサンプルを使う。
				const channel = params.channel === 'left' || params.channel === 'right' ? params.channel : 'mix';
				const amplitude = finiteNumber(params.amplitude, 1, 0, 10);
				data.fill(0);
				if (audioWindow != null) {
					const frames = audioWindow.frameCount;
					const start = 0;
					const sample = (frame: number) => audioWindow.sample(frame, channel);
					for (let x = 0; x < columns; x++) {
						let min = Infinity;
						let max = -Infinity;
						if (frames < columns) {
							const position = start + x / (columns - 1) * (frames - 1);
							const frame = Math.floor(position);
							const mix = position - frame;
							min = max = sample(frame) * (1 - mix) + sample(frame + 1) * mix;
						} else {
							// 単純な間引きでは消える短いピークをmin/maxで保持する。
							const from = start + Math.floor(x * frames / columns);
							const to = start + Math.floor((x + 1) * frames / columns);
							for (let frame = from; frame < to; frame++) {
								const value = sample(frame);
								min = Math.min(min, value);
								max = Math.max(max, value);
							}
						}
						data[x * 2] = min * amplitude;
						data[x * 2 + 1] = max * amplitude;
					}
				}
				uniforms.set([
					...params.color,
					columns, finiteNumber(params.lineWidth, 0.003, 0.001, 0.05), resolution.width / resolution.height, Number(audioWindow != null),
				]);
				device.queue.writeBuffer(uniformBuffer, 0, uniforms);
				device.queue.writeBuffer(dataBuffer, 0, data);
				const pass = beginOutputPass(ctx.commandEncoder, outputView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose() {
				uniformBuffer.destroy();
				dataBuffer.destroy();
			},
		};
	},
};

export default implementation;
