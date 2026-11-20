import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init(context) {
		const { device, defaultVertexShaderModule, resolution } = context;
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: [{ view: context.outputTextures.get('output')!.createView(), loadOp: 'clear', storeOp: 'store' }],
		};
		const pipeline = await device.createRenderPipelineAsync({
			layout: 'auto',
			vertex: { module: defaultVertexShaderModule },
			fragment: {
				module: device.createShaderModule({ code }),
				targets: [{ format: context.enable32bitDataTextures ? 'rg32float' : 'rg16float' }],
			},
		});
		// 解像度はインスタンスの寿命中に変わらないので、座標の換算係数も一度だけ渡す。
		const halfExtent = new Float32Array(getSpatialHalfExtent(resolution));
		const uniformBuffer = device.createBuffer({ size: halfExtent.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(uniformBuffer, 0, halfExtent);
		const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return {
			cacheKey: 0,
			render: ctx => {
				const pass = ctx.commandEncoder.beginRenderPass(descriptor);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => uniformBuffer.destroy(),
		};
	},
};

export default implementation;
