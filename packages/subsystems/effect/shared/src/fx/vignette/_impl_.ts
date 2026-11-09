import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import shapeDistanceCode from '@gs/shared/gpu/shape-distance.wgsl?raw';
import { implementEffect } from '../../effect-implementation.ts';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const code = shapeDistanceCode + '\n' + shaderCode;

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		mask: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const createPipelines = (includeMask: boolean) => createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color' }, sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }, includeMask ? { format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' } : null],
		});
		const colorPipelines = createPipelines(false);
		let maskPipelines: typeof colorPipelines | null = null;
		return {
			render: ctx => {
				// Size Referenceは寸法だけを換算する。Centerは共通座標のまま扱い、
				// 楕円の実距離でFeatherを評価して長軸・短軸の遷移幅を揃える。
				const referenceScale = getSizeReferenceLength(ctx.params.sizeReference, resolution) / Math.max(resolution.width, resolution.height);
				uniformValues.set({
					center: ctx.params.center,
					halfSize: ctx.params.size.map(value => value * 0.5 * referenceScale),
					halfExtent: getSpatialHalfExtent(resolution),
					rotation: (ctx.params.rotation % 1) * (2 * Math.PI),
					feather: Math.max(0, ctx.params.feather) * referenceScale,
					strength: Math.max(0, Math.min(1, ctx.params.strength)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 未接続のMaskにはテクスチャも追加の入力buffer・pipelineも確保しない。
				const maskOutput = ctx.outputDataMap.mask;
				const pipelines = maskOutput != null ? (maskPipelines ??= createPipelines(true)) : colorPipelines;
				const variant = pipelines.update({ input: ctx.params.input }, resolution);
				const pass = maskOutput != null
					? ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [ctx.outputDataMap.output, maskOutput].map(output => ({
							view: output.textureView, loadOp: 'clear' as const, storeOp: 'store' as const,
						})),
					})
					: ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => { colorPipelines.dispose(); maskPipelines?.dispose(); uniformBuffer.destroy(); },
		};
	},
});
