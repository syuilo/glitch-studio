import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import definition from './_def_.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init(context) {
		const { device, defaultVertexShaderModule, inputs } = context;
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: [{ view: context.outputTextures.get('output')!.createView(), loadOp: 'clear', storeOp: 'store' }],
		};
		const shaderModule = device.createShaderModule({
			code,
		});

		const pipeline = await device.createRenderPipelineAsync({
			vertex: {
				module: defaultVertexShaderModule,
			},
			fragment: {
				module: shaderModule,
				targets: [{
					format: INTERMEDIATE_TEXTURE_FORMAT,
				}],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: 'auto',
		});

		const uniformValues = createShaderBuffer(codeUniforms.uniforms);

		const uniformBuffer = device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 1, resource: { buffer: uniformBuffer } },
			],
		});

		return {
			cacheKey: 0,
			render: (ctx) => {
				uniformValues.set({
					x: inputs.x.value,
					y: inputs.y.value,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.commandEncoder.beginRenderPass(descriptor);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.draw(3);
				passEncoder.end();
			},
			dispose: () => {
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
