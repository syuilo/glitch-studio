import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { background: 'color', vector: 'vector', intensity: 'scalar', opacity: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const vectorScale = inputs.vectorScale.value;
				const intensityScale = inputs.intensityScale.value;
				const frequency = inputs.frequency.value;
				const phase = inputs.phase.value;
				const channelPhase = inputs.channelPhase.value;
				const brightness = inputs.brightness.value;
				if (![vectorScale, intensityScale, frequency, phase, channelPhase, brightness].every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
					throw new Error('Flow Color requires finite coloring parameters.');
				}
				uniformValues.set({
					vectorScale, intensityScale: Math.max(0, intensityScale), frequency,
					// 大きなアニメーション時刻をf32に渡す前に一周へ戻し、色の位相の精度を維持する。
					phase: phase - Math.floor(phase), channelPhase: channelPhase - Math.floor(channelPhase),
					brightness: Math.max(0, brightness),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
