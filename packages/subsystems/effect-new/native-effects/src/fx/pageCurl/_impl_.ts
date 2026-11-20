import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
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
			halfExtent: getSpatialHalfExtent(resolution),
			pixelSize: 1 / Math.max(resolution.width, resolution.height),
		});
		return createFullscreenEffect(context, {
			code,
			schema: { inputA: 'color', inputB: 'color', progress: 'scalar', backColor: 'color', backInput: 'color' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const referenceScale = getSizeReferenceLength(inputs.sizeReference.value, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					axis: { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] }[inputs.startEdge.value],
					// 0は鋭い折り返しの極限として扱い、画素数には依存しない微小半径で除算を保つ。
					curlRadius: Math.max(0.000001, inputs.curlRadius.value * referenceScale),
					backMode: { source: 0, color: 1, input: 2 }[inputs.backMode.value],
					shadowOpacity: Math.max(0, Math.min(1, inputs.shadowOpacity.value)),
					shadowSoftness: Math.max(0, inputs.shadowSoftness.value) * referenceScale,
					shading: Math.max(0, Math.min(1, inputs.shading.value)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
