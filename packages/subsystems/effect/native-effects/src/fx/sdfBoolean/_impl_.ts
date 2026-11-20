import { distanceFieldInput } from '../../distance-field-input.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const inputA = distanceFieldInput(inputs.inputA, resolution);
		const inputB = distanceFieldInput(inputs.inputB, resolution);
		uniformValues.set({
			halfExtent: getSpatialHalfExtent(resolution),
		});
		return createFullscreenEffect(context, {
			code,
			inputs: { inputA: inputA.binding, inputB: inputB.binding },
			internalLayouts: [layout],
			sampling: 'level0',
			schema: { inputA: 'scalar', inputB: 'scalar' },
			constants: { MAX_OUTPUT_DISTANCE: context.enable32bitDataTextures ? 3.4028234663852886e38 : 65504 },
			bindResources(pass) {
				const referenceScale = getSizeReferenceLength(inputs.sizeReference.value, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					inputScaleA: inputA.transparent ? inputA.scale : [1, 1],
					inputScaleB: inputB.transparent ? inputB.scale : [1, 1],
					transparentA: inputA.transparent ? 1 : 0,
					transparentB: inputB.transparent ? 1 : 0,
					operation: { union: 0, intersection: 1, difference: 2 }[inputs.operation.value],
					smoothing: Math.max(0, Math.min(inputs.smoothing.value * referenceScale, 3.4028234663852886e38)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
