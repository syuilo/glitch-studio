import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });

		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		uniformValues.set({
			resolution: [resolution.width, resolution.height],
		});
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', density: 'vector' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				seedValue[0] = inputs.seed.value;
				uniformValues.set({
					referenceLength: getSizeReferenceLength(inputs.sizeReference.value, resolution),
					randomSwap: inputs.randomSwap.value ? 1 : 0,
					randomRotation: inputs.randomRotation.value ? 1 : 0,
					randomFlipX: inputs.randomFlipX.value ? 1 : 0,
					randomFlipY: inputs.randomFlipY.value ? 1 : 0,
					amount: Math.min(1, Math.max(0, inputs.amount.value)),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
