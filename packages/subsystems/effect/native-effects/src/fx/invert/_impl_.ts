import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import type definition from './_def_.ts';
import code from './shader.wgsl?raw';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs } = context;
		const uniformValues = new Uint32Array(3);
		const uniformBuffer = device.createBuffer({ size: uniformValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			bindResources(pass) {
				uniformValues[0] = inputs.red.value ? 1 : 0;
				uniformValues[1] = inputs.green.value ? 1 : 0;
				uniformValues[2] = inputs.blue.value ? 1 : 0;
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
