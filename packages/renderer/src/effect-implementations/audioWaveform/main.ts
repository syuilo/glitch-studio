import { audioChannel, finiteNumber } from '@glitch/shared/utility/audio-spectrum.js';
import { implementEffect } from '../../effect-implementation.ts';
import { createAudioPlot } from '../audio-plot.ts';
import type definition from '@glitch/shared/effect-definitions/audioWaveform.ts';

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
		const columns = Math.max(2, Math.min(4096, resolution.width));
		const plot = createAudioPlot(wgpu.device, wgpu.defaultVertexShaderModule, columns, wgpu.intermediateTextureFormat);
		return {
			render(ctx) {
				const { params } = ctx;
				const history = params.player?.audio;
				const channel = audioChannel(params.channel);
				const duration = finiteNumber(params.duration, 0.05, 0.005, 1);
				const amplitude = finiteNumber(params.amplitude, 1, 0, 10);
				plot.data.fill(0);
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
							plot.data[x * 4 + side * 2] = min * amplitude;
							plot.data[x * 4 + side * 2 + 1] = max * amplitude;
						}
					}
				}
				plot.render(ctx, {
					color: params.color,
					rightColor: params.rightColor,
					stereo: channel === 'stereo', spectrum: false,
					lineWidth: finiteNumber(params.lineWidth, 0.003, 0.001, 0.05),
					aspectRatio: resolution.width / resolution.height, valid: !!history?.channelCount });
			},
			dispose: () => plot.dispose(),
		};
	},
});
