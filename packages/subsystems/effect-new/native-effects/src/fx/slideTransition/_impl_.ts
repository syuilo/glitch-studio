import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent, spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });

		const halfExtent = getSpatialHalfExtent(resolution);
		uniformValues.set({
			pixelSize: [2 / resolution.width, 2 / resolution.height],
		});
		return createFullscreenEffect(context, {
			code,
			schema: { inputA: 'color', inputB: 'color', progress: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const angle = (inputs.angle.value % 1) * 2 * Math.PI;
				const direction = [Math.sin(angle), Math.cos(angle)] as const;
				// いずれかの軸で矩形の全幅を移動すれば完全に画面外へ出る。
				// 等方座標で距離を求め、縦横比によって指定した角度を歪めない。
				const inverseTravelDistance = Math.max(Math.abs(direction[0]) / (halfExtent[0] * 2), Math.abs(direction[1]) / (halfExtent[1] * 2));
				uniformValues.set({
					fullOffset: spatialToNormalizedCoordinates([direction[0] / inverseTravelDistance, direction[1] / inverseTravelDistance], resolution),
					uncover: inputs.mode.value === 'uncover' ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
