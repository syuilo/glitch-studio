import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
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
			schema: { input: 'color', height: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			scalarGradients: true,
			bindResources(pass) {
				const angle = inputs.lightAngle.value * 2 * Math.PI;
				const elevation = Math.max(-0.25, Math.min(0.25, inputs.lightElevation.value)) * 2 * Math.PI;
				// +Yが上の共通座標で、角度は既存の照明と同じ右=0・時計回り。
				// Zは画面から手前へ向くので、仰角0.25 turnで正面から照らす。
				uniformValues.set({
					heightScale: inputs.heightScale.value,
					lightWrap: Math.max(0, Math.min(1, inputs.lightWrap.value)),
					lightDirection: [Math.cos(angle) * Math.cos(elevation), -Math.sin(angle) * Math.cos(elevation), Math.sin(elevation)],
					lightIntensity: Math.max(0, inputs.lightIntensity.value),
					lightColor: inputs.lightColor.value,
					ambientFrontColor: inputs.ambientFrontColor.value,
					ambientBackColor: inputs.ambientBackColor.value,
					ambientIntensity: Math.max(0, inputs.ambientIntensity.value),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
