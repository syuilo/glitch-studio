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
		const uniformBindGroupLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformBindGroup = device.createBindGroup({ layout: uniformBindGroupLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', direction: 'scalar', phase: 'scalar', frequency: 'scalar', amplitude: 'scalar', chromaticAberrationStrength: 'scalar' },
			inputs,
			internalLayouts: [uniformBindGroupLayout],
			sampling: 'level0',
			bindResources(pass) {
				const chromaticAberrationSamples = inputs.chromaticAberrationSamples.value;
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				uniformValues.set({
					aspect: [resolution.width / referenceLength, resolution.height / referenceLength],
					// 両端の赤・青と中央の緑に重みを持たせるには最低3点必要。
					// 式からの値も整数化し、描画負荷が際限なく増えないよう上限を設ける。
					chromaticAberrationSamples: Number.isFinite(chromaticAberrationSamples)
						? Math.min(64, Math.max(3, Math.round(chromaticAberrationSamples))) : 16,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, uniformBindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
