import { distanceFieldInput } from '../../distance-field-input.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const input = distanceFieldInput(inputs.input, resolution);
		return createFullscreenEffect(context, {
			code,
			inputs: { input: input.binding },
			internalLayouts: [layout],
			sampling: 'level0',
			schema: { input: 'scalar' },
			bindResources(pass) {
				// 入力の距離は共通単位のまま使い、Size Referenceの影響を受ける幅とオフセットだけを換算する。
				const referenceScale = getSizeReferenceLength(inputs.sizeReference.value, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					inputScale: input.transparent ? input.scale : [1, 1],
					inputSize: input.size == null ? [1, 1] : [input.size.width, input.size.height],
					transparentInput: input.transparent ? 1 : 0,
					nearestInput: input.transparent && input.nearest ? 1 : 0,
					offset: inputs.offset.value * referenceScale,
					strokeWidth: Math.max(0, inputs.strokeWidth.value) * referenceScale,
					feather: Math.max(0, inputs.feather.value) * referenceScale,
					mode: inputs.mode.value === 'fill' ? 0 : 1,
					strokeAlignment: { inside: 0, center: 1, outside: 2 }[inputs.strokeAlignment.value],
					antiAlias: inputs.antiAlias.value ? 1 : 0,
					invert: inputs.invert.value ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
