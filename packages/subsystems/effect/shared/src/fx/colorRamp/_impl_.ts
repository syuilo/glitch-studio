import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const colorRamp = createColorRampBindings(device, 0);
		const pipelines = createShaderInputPipeline({ device, vertex: wgpu.defaultVertexShaderModule, code: colorRamp.shaderCode + '\n' + code, schema: { input: 'scalar' }, targets: [{ format: wgpu.intermediateTextureFormat }], internalLayouts: [colorRamp.layout] });
		return {
			render: ctx => {
				const bindGroup = colorRamp.update(ctx.params.ramp);
				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); colorRamp.dispose(); },
		};
	},
});
