import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		uniformValues.set({
			aspectRatio: resolution.width / resolution.height,
		});
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				uniformValues.set({
					// レンズは出力領域を基準にする。入力自身の比率とfitはread_inputへ任せる。
					angle: inputs.angle.value * (2 * Math.PI),
					spread: Math.max(0, Math.min(1, inputs.spread.value)),
					bias: Math.max(-1, Math.min(1, inputs.bias.value)),
					perspective: Math.max(0, Math.min(1, inputs.perspective.value)),
					count: Math.max(2, Math.min(50, Math.floor(inputs.count.value))),
					dispersion: Math.max(0, Math.min(1, inputs.dispersion.value)),
					dispersionShift: Math.max(-1, Math.min(1, inputs.dispersionShift.value)),
					dispersionColor: Math.max(0, Math.min(1, inputs.dispersionColor.value)),
					focusCenter: Math.max(0, Math.min(1, inputs.focusCenter.value)),
					focusEdges: Math.max(0, Math.min(1, inputs.focusEdges.value)),
					swirl: Math.max(-1, Math.min(1, inputs.swirl.value)),
					lensBulge: Math.max(-1, Math.min(1, inputs.lensBulge.value)),
					lensCircle: Math.max(0, Math.min(1, inputs.lensCircle.value)),
					grainMixer: Math.max(0, Math.min(1, inputs.grainMixer.value)),
					grainOverlay: Math.max(0, Math.min(1, inputs.grainOverlay.value)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
