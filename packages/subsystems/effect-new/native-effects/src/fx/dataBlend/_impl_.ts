import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

// shader.wgslのモード番号と揃える。
const blendModes: Record<string, number> = {
	normal: 0,
	add: 1,
	subtract: 2,
	multiply: 3,
	darken: 4,
	lighten: 5,
	screen: 6,
	overlay: 7,
	difference: 8,
	exclusion: 9,
	none: 10,
	colorBurn: 11,
	colorDodge: 12,
	softLight: 13,
	hardLight: 14,
	hue: 15,
	saturation: 16,
	color: 17,
	luminosity: 18,
	replace: 19,
	emission: 20,
};

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { inputA: 'any', inputB: 'any', amount: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				uniformValues.set({
					blendMode: blendModes[inputs.blendMode.value] ?? blendModes.normal,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
