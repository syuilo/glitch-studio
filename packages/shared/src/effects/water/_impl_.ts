// Adapted from Paper Design's Water (Apache-2.0; see LICENSE).
// Modified for WebGPU node inputs, without background or image layout controls.
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import type definition from './_def_.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution, params, fallbackTexture }) => {
		const { device } = wgpu;
		const module = device.createShaderModule({ code });
		const pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module, targets: [{ format: wgpu.intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const sampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'mirror-repeat',
			addressModeV: 'mirror-repeat',
		});
		let inputTexture = params.input;
		let bindGroup: GPUBindGroup;
		const updateInput = () => {
			bindGroup = device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } },
					{ binding: 1, resource: sampler },
					{ binding: 2, resource: (inputTexture ?? fallbackTexture).createView() },
				],
			});
		};
		updateInput();
		return {
			render: (ctx) => {
				if (ctx.params.input !== inputTexture) {
					inputTexture = ctx.params.input;
					updateInput();
				}
				const p = ctx.params;
				uniformValues.set({
					...p,
					// The input fills the output; keep the pattern isotropic in that space.
					aspectRatio: resolution.width / resolution.height,
					colorHighlight: [...p.colorHighlight, p.colorHighlightAlpha],
					// Upstream frame is milliseconds; explicit time supports deterministic seeking.
					time: p.time * p.speed + p.frame / 1000,
					size: Math.max(0.01, p.size),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => uniformBuffer.destroy(),
		};
	},
});
