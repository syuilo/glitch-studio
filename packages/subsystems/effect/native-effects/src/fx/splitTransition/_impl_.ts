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
		const referenceSizes = { inputA: { width: 1, height: 1 }, inputB: { width: 1, height: 1 } };
		return createFullscreenEffect(context, {
			code,
			schema: { inputA: 'color', inputB: 'color' },
			inputs,
			sampling: 'level0',
			internalLayouts: [layout],
			samplingOverrides: { referenceResolutions: referenceSizes },
			bindResources(pass) {
				const sizeReference = inputs.sizeReference.value;
				const reverse = inputs.reverse.value;
				const direction = inputs.direction.value;
				const vertical = direction === 'vertical';
				const axisLength = vertical ? height : width;
				const referenceLength = getSizeReferenceLength(sizeReference, resolution);
				const gap = Math.min(axisLength, Math.max(0, inputs.gap.value) * referenceLength);
				const progress = Math.min(1, Math.max(0, inputs.progress.value));
				// Gapを確保してから残り幅を按分すると、進捗の端点にも余白が残る。
				// 透明帯全体が画面外へ抜ける距離だけ移動させ、端点でA/Bを全面に配置する。
				const regionLengthA = Math.max(0, axisLength - progress * (axisLength + gap));
				const regionLengthB = Math.max(0, progress * (axisLength + gap) - gap);
				const regionSizeA = { width: vertical ? width : regionLengthA, height: vertical ? regionLengthA : height };
				const regionSizeB = { width: vertical ? width : regionLengthB, height: vertical ? regionLengthB : height };
				// Reverseは配置先だけを変更する。参照座標を反転すると画像自体も鏡像になる。
				const offsetA = reverse ? axisLength - regionLengthA : 0;
				const offsetB = reverse ? 0 : axisLength - regionLengthB;
				uniformValues.set({
					regionSizeA: [regionSizeA.width, regionSizeA.height],
					regionSizeB: [regionSizeB.width, regionSizeB.height],
					regionOffsetA: vertical ? [0, offsetA] : [offsetA, 0],
					regionOffsetB: vertical ? [0, offsetB] : [offsetB, 0],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 各入力は割り当て先の領域にFitさせる。空の領域はシェーダーで描画しないため、
				// Fitの計算だけ正の寸法を渡す。実在する領域は1px未満でも寸法を丸めない。
				referenceSizes.inputA.width = regionSizeA.width > 0 ? regionSizeA.width : 1;
				referenceSizes.inputA.height = regionSizeA.height > 0 ? regionSizeA.height : 1;
				referenceSizes.inputB.width = regionSizeB.width > 0 ? regionSizeB.width : 1;
				referenceSizes.inputB.height = regionSizeB.height > 0 ? regionSizeB.height : 1;
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
