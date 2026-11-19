import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
// Adapted from Paper Design's Water (Apache-2.0; see LICENSE).
// Modified for WebGPU node inputs, without background or image layout controls.
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				uniformValues.set({
					highlights: inputs.highlights.value,
					layering: inputs.layering.value,
					edges: inputs.edges.value,
					waves: inputs.waves.value,
					caustic: inputs.caustic.value,
					// 入力のfitとは独立に、出力空間で水面模様の縦横の単位を揃える。
					coordinateScale: [resolution.width / referenceLength, resolution.height / referenceLength],
					// 色自体のalphaと独立した強度を掛ける。RGBAへ5成分を渡すとuniform転送が失敗する。
					colorHighlight: [inputs.colorHighlight.value[0], inputs.colorHighlight.value[1], inputs.colorHighlight.value[2], inputs.colorHighlight.value[3] * inputs.colorHighlightAlpha.value],
					// Upstream frame is milliseconds; explicit time supports deterministic seeking.
					time: inputs.time.value * inputs.speed.value + inputs.frame.value / 1000,
					density: Math.max(1, inputs.density.value),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
