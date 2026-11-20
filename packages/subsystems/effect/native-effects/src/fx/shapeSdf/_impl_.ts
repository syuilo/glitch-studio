import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init(context) {
		const { device, defaultVertexShaderModule, resolution, inputs } = context;
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: [{ view: context.outputTextures.get('output')!.createView(), loadOp: 'clear', storeOp: 'store' }],
		};
		const pipeline = await device.createRenderPipelineAsync({
			layout: 'auto',
			vertex: { module: defaultVertexShaderModule, entryPoint: 'vs' },
			fragment: { module: device.createShaderModule({ code }), entryPoint: 'fs', targets: [{ format: context.enable32bitDataTextures ? 'r32float' : 'r16float' }] },
		});
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return {
			cacheKey: 0,
			render: ctx => {
				// Size Referenceは見た目の寸法だけに適用し、位置・形状計算・出力距離は共通単位で揃える。
				const referenceScale = getSizeReferenceLength(inputs.sizeReference.value, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					position: inputs.position.value,
					halfSize: inputs.size.value.map(value => value * 0.5 * referenceScale),
					halfExtent: getSpatialHalfExtent(resolution),
					rotation: (inputs.rotation.value % 1) * (2 * Math.PI),
					cornerRadius: Math.max(0, Math.min(inputs.cornerRadius.value * referenceScale, ...inputs.size.value.map(value => value * 0.5 * referenceScale))),
					shapeType: inputs.shape.value === 'ellipse' ? 0 : 1,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const pass = ctx.commandEncoder.beginRenderPass(descriptor);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, group);
				pass.draw(3);
				pass.end();
			},
			dispose: () => uniformBuffer.destroy(),
		};
	},
};

export default implementation;
