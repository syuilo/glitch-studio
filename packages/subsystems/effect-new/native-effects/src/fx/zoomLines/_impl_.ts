import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			bindResources(pass) {
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				uniformValues.set({
					aspect: [resolution.width / referenceLength * 0.5, resolution.height / referenceLength * 0.5],
					position: spatialToNormalizedCoordinates(inputs.position.value, resolution),
					// 元のUIと同じ頻度の変化にする。時間・seedは元の固定値を維持する。
					frequency: Math.max(0, inputs.frequency.value) ** 2,
					density: Math.min(1, Math.max(0, inputs.density.value)),
					outlineThickness: Math.min(1, Math.max(0, inputs.outlineThickness.value)),
					maskSize: Math.max(0, inputs.maskSize.value),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
