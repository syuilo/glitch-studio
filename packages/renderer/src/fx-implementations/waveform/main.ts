import type definition from '@glitch/shared/fx-definitions/waveform.ts';
import { createWaveform } from '@glitch/shared/utility/waveform/waveform.ts';
import { implementEffect } from '../../fx-implementation.ts';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => ({
		output: wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	}),
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution }) => {
		const waveform = createWaveform({ device, vertexShaderModule: defaultVertexShaderModule, format: intermediateTextureFormat });
		return {
			render: ctx => {
				const divisor = ctx.params.resolution;
				if (waveform.prepare(ctx.params.input, {
					mode: ctx.params.mode,
					direction: ctx.params.direction,
					intensity: ctx.params.intensity,
					size: {
						width: Math.max(1, Math.ceil(resolution.width / divisor)),
						height: Math.max(1, Math.ceil(resolution.height / divisor)),
					},
				}, ctx.commandEncoder)) {
					const pass = ctx.createComputePassEncoder(ctx.commandEncoder);
					waveform.accumulate(pass);
					pass.end();
				}
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				waveform.render(pass);
				pass.end();
			},
			dispose: () => waveform.dispose(),
		};
	},
});
