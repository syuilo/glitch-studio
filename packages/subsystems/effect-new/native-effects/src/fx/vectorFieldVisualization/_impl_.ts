import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
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
		const colorRamp = createColorRampBindings(device, 1);
		return createFullscreenEffect(context, {
			code: colorRamp.shaderCode + '\n' + code,
			schema: { vector: 'vector' },
			inputs,
			internalLayouts: [layout, colorRamp.layout],
			sampling: 'level0',
			bindResources(pass) {
				const shortDimension = Math.min(resolution.width, resolution.height);
				uniformValues.set({
					aspect: [resolution.width / shortDimension, resolution.height / shortDimension],
					cellSize: getSizeReferenceLength(inputs.sizeReference.value, resolution) / shortDimension / Math.max(1, inputs.density.value),
					maximumMagnitude: Math.max(0.000001, inputs.maximumMagnitude.value),
					lineWidth: Math.min(0.5, Math.max(0, inputs.lineWidth.value)),
					gridWidth: Math.min(0.5, Math.max(0, inputs.gridWidth.value)),
					zeroColor: inputs.zeroColor.value,
					overflowColor: inputs.overflowColor.value,
					gridColor: inputs.gridColor.value,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampBindGroup = colorRamp.update(inputs.ramp.value);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(1, rampBindGroup);
			},
			disposeResources() {
				colorRamp.dispose();
				uniformBuffer.destroy();
			},
		});
	},
};

export default implementation;
