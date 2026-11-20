import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
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
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				// DensityはRGBの3サブピクセルをまとめたセルの基準寸法あたりの数。
				// 1未満は1にし、密度の上限や1pxの下限は設けない。
				const density = Math.max(1, inputs.density.value);
				uniformValues.set({
					cellSize: [
						// [-1, 1]の全幅2へ換算し、Density=1で基準寸法全体を覆う。
						2 * (referenceLength / resolution.width) / density,
						2 * (referenceLength / resolution.height) / density,
					],
					border: Math.min(1, Math.max(0, inputs.border.value)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
