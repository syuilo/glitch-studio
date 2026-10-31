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
				// 公開する寸法だけを換算する。出力SDFは後段と共有する高さ=1の距離を維持する。
				const referenceScale = getSizeReferenceLength(ctx.params.sizeReference, resolution) / resolution.height;
				uniformValues.set({
					position: ctx.params.position,
					halfSize: ctx.params.size.map(value => value * 0.5 * referenceScale),
					// 位置は画面座標、距離は縦横とも描画領域の高さを1とする。
					// 比率補正は形状を移動してから行い、横長・縦長でも円を歪ませない。
					aspectRatio: resolution.width / resolution.height,
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
