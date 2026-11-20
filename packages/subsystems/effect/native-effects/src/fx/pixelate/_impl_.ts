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
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		uniformValues.set({
			resolution: [resolution.width, resolution.height],
		});
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', density: 'vector', rotation: 'scalar' },
			inputs,
			internalLayouts: [layout],
			// ブロック境界や空間的に変化するパラメータで参照座標が不連続になるため、LODを固定する。
			sampling: 'level0',
			bindResources(pass) {
				// 式からの小数・範囲外の値も、有限の正のサンプル数に揃える。
				const samples = Number.isFinite(inputs.samples.value) ? Math.min(256, Math.max(1, Math.round(inputs.samples.value))) : 1;
				uniformValues.set({
					referenceLength: getSizeReferenceLength(inputs.sizeReference.value, resolution),
					samples,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
