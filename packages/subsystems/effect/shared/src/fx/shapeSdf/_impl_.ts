import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import shapeDistanceCode from '@gs/shared/gpu/shape-distance.wgsl?raw';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const code = shapeDistanceCode + '\n' + shaderCode;

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: wgpu.defaultVertexShaderModule, entryPoint: 'vs' },
			fragment: { module: device.createShaderModule({ code }), entryPoint: 'fs', targets: [{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' }] },
		});
		const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return {
			render: ctx => {
				// 形状計算は内部の高さ単位で行い、出力時に長辺全体=1の距離へ換算する。
				const referenceScale = getSizeReferenceLength(ctx.params.sizeReference, resolution) / resolution.height;
				uniformValues.set({
					position: spatialToNormalizedCoordinates(ctx.params.position, resolution),
					halfSize: ctx.params.size.map(value => value * 0.5 * referenceScale),
					// 位置は画像参照座標へ、寸法は形状計算用の高さ単位へ換算する。
					// 比率補正は形状を移動してから行い、横長・縦長でも円を歪ませない。
					aspectRatio: resolution.width / resolution.height,
					distanceScale: resolution.height / Math.max(resolution.width, resolution.height),
					rotation: (ctx.params.rotation % 1) * (2 * Math.PI),
					cornerRadius: Math.max(0, Math.min(ctx.params.cornerRadius * referenceScale, ...ctx.params.size.map(value => value * 0.5 * referenceScale))),
					shapeType: ctx.params.shape === 'ellipse' ? 0 : 1,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, group);
				pass.draw(6);
				pass.end();
			},
			dispose: () => uniformBuffer.destroy(),
		};
	},
});
