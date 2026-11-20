import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { calculateSplitLayout } from './layout.ts';
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
		const longSide = Math.max(width, height);
		const halfExtent = getSpatialHalfExtent(resolution);
		const referenceSizes = { inputA: { width: 1, height: 1 }, inputB: { width: 1, height: 1 } };
		uniformValues.set({ halfExtent, longSide });
		let previousLayout: readonly (number | string)[] = [];
		return createFullscreenEffect(context, {
			code,
			schema: { inputA: 'color', inputB: 'color' },
			inputs,
			sampling: 'level0',
			internalLayouts: [layout],
			samplingOverrides: { referenceResolutions: referenceSizes },
			bindResources(pass) {
				pass.setBindGroup(0, bindGroup);
				const sizeReference = inputs.sizeReference.value;
				const gap = inputs.gap.value;
				const offset = inputs.offset.value;
				const angle = inputs.angle.value;
				const spatialGap = gap * getSizeReferenceLength(sizeReference, resolution) / longSide;
				const layoutValues = [angle, offset, spatialGap];
				if (layoutValues.every((value, i) => value === previousLayout[i])) return;
				const splitLayout = calculateSplitLayout(halfExtent, angle, offset, spatialGap);
				const { regionA, regionB } = splitLayout;
				uniformValues.set({
					normal: splitLayout.normal,
					boundaryA: splitLayout.boundaryA,
					boundaryB: splitLayout.boundaryB,
					centerA: regionA?.center ?? [0, 0],
					centerB: regionB?.center ?? [0, 0],
					halfSizeA: regionA?.halfSize ?? [0, 0],
					halfSizeB: regionB?.halfSize ?? [0, 0],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 各入力のFitは割り当て先の矩形を基準とする。実在する領域は1px未満でも寸法を丸めず、
				// 空の領域だけ0除算を避けるために1を代入する。
				referenceSizes.inputA.width = regionA == null ? 1 : regionA.halfSize[0] * 2 * longSide;
				referenceSizes.inputA.height = regionA == null ? 1 : regionA.halfSize[1] * 2 * longSide;
				referenceSizes.inputB.width = regionB == null ? 1 : regionB.halfSize[0] * 2 * longSide;
				referenceSizes.inputB.height = regionB == null ? 1 : regionB.halfSize[1] * 2 * longSide;
				previousLayout = layoutValues;
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
