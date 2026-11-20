import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import code, { uniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs } = context;
		const colorRamp = createColorRampBindings(device, 0);
		const repetitionValues = createShaderBuffer(uniforms.effectRepetition);
		const repetitionBuffer = device.createBuffer({ size: repetitionValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const repetitionLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const repetitionBindGroup = device.createBindGroup({ layout: repetitionLayout, entries: [
			{ binding: 0, resource: { buffer: repetitionBuffer } },
		] });
		return createFullscreenEffect(context, {
			code: colorRamp.shaderCode + '\n' + code,
			schema: { input: 'scalar', repeatCount: 'scalar' },
			inputs,
			internalLayouts: [colorRamp.layout, repetitionLayout],
			bindResources(pass) {
				repetitionValues.set({ mode: { clamp: 0, wrap: 1, pingPong: 2 }[inputs.mode.value], repeatMode: inputs.repeatMode.value === 'wrap' ? 0 : 1 });
				device.queue.writeBuffer(repetitionBuffer, 0, repetitionValues.arrayBuffer);
				pass.setBindGroup(0, colorRamp.update(inputs.ramp.value));
				pass.setBindGroup(1, repetitionBindGroup);
			},
			disposeResources() {
				colorRamp.dispose();
				repetitionBuffer.destroy();
			},
		});
	},
};

export default implementation;
