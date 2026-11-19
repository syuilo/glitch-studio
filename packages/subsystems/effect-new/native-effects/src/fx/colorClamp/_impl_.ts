import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createNativeEffectInputBindings } from '../../shader-input.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init({ device, resolution, inputs, outputTextures, defaultVertexShaderModule }) {
		const output = outputTextures.get('output')!;
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }],
		};
		const bindings = createNativeEffectInputBindings({
			device, resolution, inputs, group: 0,
			schema: { input: 'color', rMax: 'scalar', rMin: 'scalar', gMax: 'scalar', gMin: 'scalar', bMax: 'scalar', bMin: 'scalar' },
		});
		try {
			const pipeline = await device.createRenderPipelineAsync({
				layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
				vertex: { module: defaultVertexShaderModule },
				fragment: { module: device.createShaderModule({ code: bindings.code + '\n' + code }), entryPoint: 'fs', targets: [{ format: output.format }] },
				primitive: { topology: 'triangle-list' },
			});
			return {
				cacheKey: 0,
				render({ commandEncoder }) {
					const group = bindings.getBindGroup();
					const pass = commandEncoder.beginRenderPass(descriptor);
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, group);
					pass.draw(3);
					pass.end();
				},
				dispose: bindings.dispose,
			};
		} catch (error) {
			bindings.dispose();
			throw error;
		}
	},
};

export default implementation;
