import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { transitionOutputs } from '../../transition/outputs.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, 'inputA' | 'inputB'> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const outputs = transitionOutputs(context.outputTextures, code, { progress: 'scalar' });
		uniformValues.set({
			halfExtent: getSpatialHalfExtent(resolution),
			pixelSize: 1 / Math.max(resolution.width, resolution.height),
		});
		return createFullscreenEffect(context, {
			...outputs,
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const referenceScale = getSizeReferenceLength(inputs.sizeReference.value, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					feather: Math.max(0, inputs.feather.value) * (inputs.featherUnit.value === 'distance' ? referenceScale : 1),
					center: inputs.center.value,
					startAngle: inputs.startAngle.value % 1,
					direction: { clockwise: 0, counterclockwise: 1, both: 2 }[inputs.direction.value],
					angularFeather: inputs.featherUnit.value === 'angle' ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
