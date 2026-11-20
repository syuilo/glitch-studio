import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const modes = {
	invert: 0,
	clear: 1,
	set: 2,
	swap: 3,
	randomize: 4,
};
const patterns = {
	blocks: 0,
	horizontal: 1,
	vertical: 2,
	wholeImage: 3,
};
const clampInteger = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });

		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		uniformValues.set({
			resolution: [resolution.width, resolution.height],
		});
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', probability: 'scalar', density: 'vector' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const bitDepth = clampInteger(inputs.bitDepth.value, 1, 16);
				const firstBit = clampInteger(inputs.firstBit.value, 0, bitDepth - 1);
				const lastBit = clampInteger(inputs.lastBit.value, 0, bitDepth - 1);
				seedValue[0] = inputs.seed.value;
				uniformValues.set({
					referenceLength: getSizeReferenceLength(inputs.sizeReference.value, resolution),
					mode: modes[inputs.mode.value],
					pattern: patterns[inputs.pattern.value],
					bitDepth,
					firstBit: Math.min(firstBit, lastBit),
					lastBit: Math.max(firstBit, lastBit),
					channels: Number(inputs.red.value) | (Number(inputs.green.value) << 1) | (Number(inputs.blue.value) << 2),
					sharedErrors: Number(inputs.sharedErrors.value),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
