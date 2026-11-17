import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { calculateRadialSplitRegions } from './layout.ts';
import code, { uniforms as codeUniforms, structs as codeStructs } from './shader.wgsl?shader';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const regionValues = createShaderBuffer(codeStructs.Region);
		const regionStride = regionValues.arrayBuffer.byteLength;
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { inputs: { array: 'color' } },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout], sampling: 'level0',
		});
		let regionResources: { count: number; buffer: GPUBuffer; bindGroup: GPUBindGroup } | null = null;
		return {
			render: ctx => {
				const { inputs, center, startAngle, direction, sizeReference } = ctx.params;
				const output = ctx.outputDataMap.output;
				const { width, height } = output.texture;
				const longSide = Math.max(width, height);
				const centerInPixels = [center[0] * longSide, center[1] * longSide] as const;
				const gapInPixels = Math.max(0, ctx.params.gap) * getSizeReferenceLength(sizeReference, output.texture);
				const regions = calculateRadialSplitRegions({ resolution: output.texture, inputCount: inputs.length, centerInPixels, startAngle, direction, gapInPixels });
				// 空配列でも有効なstorage bindingを持たせる。入力数の変更時だけ確保し直す。
				const count = Math.max(1, inputs.length);
				if (regionResources == null || regionResources.count !== count) {
					const buffer = device.createBuffer({ size: count * regionStride, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
					const bindGroup = device.createBindGroup({ layout, entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						{ binding: 1, resource: { buffer } },
					] });
					regionResources?.buffer.destroy();
					regionResources = { count, buffer, bindGroup };
				}
				const regionData = new Uint8Array(count * regionStride);
				for (const [index, region] of regions.entries()) {
					if (region.bounds == null) continue;
					const { center: boundsCenter, resolution } = region.bounds;
					regionValues.set({ bounds: [...boundsCenter, resolution.width, resolution.height], startPlane: region.startPlane, endPlane: region.endPlane });
					// 構造体の配置とstrideは事前解析結果を使い、WGSLのpaddingを手書きしない。
					regionData.set(new Uint8Array(regionValues.arrayBuffer), index * regionStride);
				}
				device.queue.writeBuffer(regionResources.buffer, 0, regionData);
				uniformValues.set({ canvasSize: [width, height], center: centerInPixels, hasGap: Number(gapInPixels > 0) });
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ inputs }, output.texture, {
					inputs: regions.map(region => region.bounds?.resolution ?? { width: 1, height: 1 }),
				});
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, regionResources.bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				regionResources?.buffer.destroy();
				uniformBuffer.destroy();
			},
		};
	},
});
