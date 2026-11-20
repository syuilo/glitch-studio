import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
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
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });

		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				// 選択した基準寸法あたりのセル数。1未満は1にし、密度の上限や1pxの下限は設けない。
				const densityX = Math.max(1, inputs.density.value[0]);
				const densityY = Math.max(1, inputs.density.value[1]);
				seedValue[0] = inputs.seed.value;
				uniformValues.set({
					cellSize: [
						// 座標の全幅は2。Density=1なら基準寸法全体を覆うセルになる。
						2 * (referenceLength / resolution.width) / densityX,
						2 * (referenceLength / resolution.height) / densityY,
					],
					amount: Math.min(1, Math.max(0, inputs.amount.value / 100)),
					alphaRandomness: Math.min(1, Math.max(0, inputs.alphaRandomness.value)),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					rgb: inputs.rgb.value ? 1 : 0,
					cmy: inputs.cmy.value ? 1 : 0,
					black: inputs.black.value ? 1 : 0,
					white: inputs.white.value ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
