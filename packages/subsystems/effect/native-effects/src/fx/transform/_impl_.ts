import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type definition from './_def_.ts';
import code from './shader.wgsl?raw';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const halfExtent = new Float32Array(getSpatialHalfExtent(resolution));
		const uniformBuffer = device.createBuffer({ size: halfExtent.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(uniformBuffer, 0, halfExtent);
		const layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', translation: 'vector', scale: 'vector', rotation: 'scalar' },
			inputs,
			internalLayouts: [layout],
			// Scaleがほぼ0の画素を先に返した後も入力を読むため、LODを明示する。
			sampling: 'level0',
			bindResources(pass) {
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
