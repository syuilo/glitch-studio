import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import seedrandom from 'seedrandom';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const maxTearings = 128;

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });

		const shifts = new Float32Array(maxTearings * 4);
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const amount = Math.min(maxTearings, Math.max(0, Math.trunc(inputs.amount.value)));
				const rnd = seedrandom(inputs.seed.value.toString());
				for (let i = 0; i < amount; i++) {
					const offset = i * 4;
					// 帯の中心もシェーダーと同じ[-1, 1]の座標で渡す。
					shifts[offset] = rnd() * 2 - 1;
					shifts[offset + 1] = (1 - rnd() * 2) * inputs.strength.value;
					shifts[offset + 2] = rnd() * (inputs.size.value / 100) * 0.5;
				}
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				uniformValues.set({
					coordinateScale: [resolution.width / referenceLength, resolution.height / referenceLength],
					amount,
					angle: inputs.angle.value * (2 * Math.PI),
					channelShift: inputs.channelShift.value,
					shifts,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
