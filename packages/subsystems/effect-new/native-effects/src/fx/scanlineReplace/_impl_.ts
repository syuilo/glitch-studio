import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
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
		uniformValues.set({
			halfExtent: getSpatialHalfExtent(resolution),
		});
		return createFullscreenEffect(context, {
			code,
			schema: { inputA: 'color', inputB: 'color', progress: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const referenceScale = getSizeReferenceLength(inputs.sizeReference.value, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					bandSize: Math.max(0.000001, inputs.bandSize.value) * referenceScale,
					stagger: Math.max(0, Math.min(1, inputs.stagger.value)),
					softness: Math.max(0, inputs.softness.value),
					displacement: Math.max(0, inputs.displacement.value) * referenceScale,
					chromaticShift: Math.max(0, inputs.chromaticShift.value) * referenceScale,
					seed: inputs.seed.value >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
