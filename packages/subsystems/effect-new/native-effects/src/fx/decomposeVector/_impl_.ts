import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import vertex from '@gs/shared/gpu/vertex.wgsl?raw';
import { createTextureEffectInstance } from '@gs/subsystems_effect-new_renderer/texture-effect-instance.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/native-effect/native-effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const decomposeVector: NativeEffectImplementation = options => {
	const { device } = options;
	const format = options.enable32bitDataTextures ? 'r32float' : 'r16float';
	return createTextureEffectInstance<typeof definition>(options, { x: format, y: format }, outputs => {
		const pipeline = createShaderInputPipeline({
			device,
			vertex: device.createShaderModule({ code: vertex }),
			code,
			schema: { input: 'vector' },
			targets: [{ format }, { format }],
			sampling: 'level0',
		});
		return {
			render(request) {
				const variant = pipeline.update({ input: request.params.input }, options.resolution);
				const pass = request.commandEncoder.beginRenderPass({
					colorAttachments: [outputs.x, outputs.y].map<GPURenderPassColorAttachment>(({ view }) => ({
						view, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store',
					})),
				});
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(pipeline.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => pipeline.dispose(),
		};
	});
};

export default decomposeVector;
