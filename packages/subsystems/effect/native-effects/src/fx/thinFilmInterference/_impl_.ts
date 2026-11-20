import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createSpectralSamples } from '../../optics/spectral-samples.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const spectralSamples = createSpectralSamples();
		const spectralBuffer = device.createBuffer({ size: spectralSamples.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(spectralBuffer, 0, spectralSamples);
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const group = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: { buffer: spectralBuffer } },
		] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'scalar', incidenceAngle: 'scalar', lightColor: 'color', opacity: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				uniformValues.set({
					minimumThickness: Math.max(0, inputs.minimumThickness.value),
					maximumThickness: Math.max(0, inputs.maximumThickness.value),
					// 外側を空気とし、両屈折率を1以上にすることで全反射の複素位相を扱わずに済む。
					// 金属・吸収・波長による屈折率の分散は、この誘電体モデルには含めない。
					filmIor: Math.max(1, inputs.filmIor.value),
					substrateIor: Math.max(1, inputs.substrateIor.value),
					brightness: Math.max(0, inputs.brightness.value),
					transmission: inputs.mode.value === 'transmission' ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() {
				uniformBuffer.destroy();
				spectralBuffer.destroy();
			},
		});
	},
};

export default implementation;
