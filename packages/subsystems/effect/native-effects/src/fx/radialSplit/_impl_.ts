import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { calculateRadialSplitRegions } from './layout.ts';
import code, { uniforms as codeUniforms, structs as codeStructs } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const regionValues = createShaderBuffer(codeStructs.Region);
		const regionStride = regionValues.arrayBuffer.byteLength;
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const { width, height } = resolution;
		const longSide = Math.max(width, height);
		const inputCount = inputs.inputs.elements.length;
		// 入力が空でもstorage bufferを有効なサイズで束縛できるよう、1領域分は確保する。
		const regionData = new Uint8Array(Math.max(1, inputCount) * regionStride);
		const regionBytes = new Uint8Array(regionValues.arrayBuffer);
		const regionBuffer = device.createBuffer({ size: regionData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const bindGroup = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: { buffer: regionBuffer } },
		] });
		const referenceSizes = Array.from({ length: inputCount }, () => ({ width: 1, height: 1 }));
		uniformValues.set({ canvasSize: [width, height] });
		let previousLayout: readonly (number | string)[] = [];
		return createFullscreenEffect(context, {
			code,
			schema: { inputs: { array: 'color' } },
			inputs,
			sampling: 'level0',
			internalLayouts: [layout],
			samplingOverrides: { referenceResolutions: { inputs: referenceSizes } },
			bindResources(pass) {
				pass.setBindGroup(0, bindGroup);
				const sizeReference = inputs.sizeReference.value;
				const direction = inputs.direction.value;
				const startAngle = inputs.startAngle.value;
				const center = inputs.center.value;
				const gapInPixels = Math.max(0, inputs.gap.value) * getSizeReferenceLength(sizeReference, resolution);
				// 動画入力だけが更新されたフレームでは領域のクリッピングとstorage bufferの転送を省く。
				const layoutValues = [center[0], center[1], gapInPixels, startAngle, direction];
				if (layoutValues.every((value, i) => value === previousLayout[i])) return;
				const centerInPixels = [center[0] * longSide, center[1] * longSide] as const;
				const regions = calculateRadialSplitRegions({ resolution, inputCount, centerInPixels, startAngle, direction, gapInPixels });
				for (const [index, region] of regions.entries()) {
					if (region.bounds == null) {
						// 前フレームで可視だった領域のboundsを残さない。
						regionData.fill(0, index * regionStride, (index + 1) * regionStride);
						continue;
					}
					Object.assign(referenceSizes[index], region.bounds.resolution);
					const { center: boundsCenter, resolution } = region.bounds;
					regionValues.set({ bounds: [...boundsCenter, resolution.width, resolution.height], startPlane: region.startPlane, endPlane: region.endPlane });
					// 構造体の配置とstrideは事前解析結果を使い、WGSLのpaddingを手書きしない。
					regionData.set(regionBytes, index * regionStride);
				}
				device.queue.writeBuffer(regionBuffer, 0, regionData);
				uniformValues.set({ center: centerInPixels, hasGap: Number(gapInPixels > 0) });
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				previousLayout = layoutValues;
			},
			disposeResources() {
				regionBuffer.destroy();
				uniformBuffer.destroy();
			},
		});
	},
};

export default implementation;
