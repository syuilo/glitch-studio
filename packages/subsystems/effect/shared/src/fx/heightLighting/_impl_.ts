import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', height: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout], sampling: 'level0', scalarGradients: true,
		});
		return {
			render: ctx => {
				const params = ctx.params;
				const angle = params.lightAngle * 2 * Math.PI;
				const elevation = Math.max(-0.25, Math.min(0.25, params.lightElevation)) * 2 * Math.PI;
				// +Yが上の共通座標で、角度は既存の照明と同じ右=0・時計回り。
				// Zは画面から手前へ向くので、仰角0.25 turnで正面から照らす。
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution),
					heightScale: params.heightScale,
					lightWrap: Math.max(0, Math.min(1, params.lightWrap)),
					lightDirection: [Math.cos(angle) * Math.cos(elevation), -Math.sin(angle) * Math.cos(elevation), Math.sin(elevation)],
					lightIntensity: Math.max(0, params.lightIntensity),
					lightColor: params.lightColor,
					ambientFrontColor: params.ambientFrontColor,
					ambientBackColor: params.ambientBackColor,
					ambientIntensity: Math.max(0, params.ambientIntensity),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: params.input, height: params.height }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); uniformBuffer.destroy(); },
		};
	},
});
