import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const { width, height } = resolution;
		const inputCount = inputs.inputs.elements.length;
		const referenceSize = { width: 1, height: 1 };
		uniformValues.set({ canvasSize: [width, height] });
		return createFullscreenEffect(context, {
			code,
			schema: { inputs: { array: 'color' } },
			inputs,
			sampling: 'level0',
			internalLayouts: [layout],
			samplingOverrides: { referenceResolutions: { inputs: referenceSize } },
			bindResources(pass) {
				const sizeReference = inputs.sizeReference.value;
				const direction = inputs.direction.value;
				const referenceLength = getSizeReferenceLength(sizeReference, resolution);
				const vertical = direction === 'vertical';
				// 余白と間隔が領域を使い切った場合は画像寸法を0で止める。
				// 負の寸法による反転を防ぎ、入力1個ではGapを完全に無視する。
				const padding = Math.min(Math.min(width, height) / 2, Math.max(0, inputs.padding.value) * referenceLength);
				const innerWidth = Math.max(0, width - 2 * padding);
				const innerHeight = Math.max(0, height - 2 * padding);
				const axisLength = vertical ? innerHeight : innerWidth;
				const gap = inputCount > 1 ? Math.min(axisLength / (inputCount - 1), Math.max(0, inputs.gap.value) * referenceLength) : 0;
				const cellLength = Math.max(0, axisLength - Math.max(0, inputCount - 1) * gap) / Math.max(1, inputCount);
				const cellWidth = vertical ? innerWidth : cellLength;
				const cellHeight = vertical ? cellLength : innerHeight;
				uniformValues.set({ cellSize: [cellWidth, cellHeight], padding, gap, vertical: Number(vertical) });
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// Fitには各画像を収めるセルの縦横比を使う。シェーダーには空のセルを判定できるよう実寸を渡し、
				// Fitの計算だけは0除算を避けるため空の寸法を1に置き換える。
				referenceSize.width = cellWidth > 0 ? cellWidth : 1;
				referenceSize.height = cellHeight > 0 ? cellHeight : 1;
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
