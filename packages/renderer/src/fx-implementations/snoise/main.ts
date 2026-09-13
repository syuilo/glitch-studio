import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../fx-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from '@glitch/shared/fx-definitions/snoise.ts';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enableFloat32Filtering ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu, resolution }) => {
		const shaderModule = wgpu.device.createShaderModule({
			code: code,
		});

		const shaderDataDefinitions = makeShaderDataDefinitions(code);
		// データ入力はtextureLoadで読み、32bitテクスチャのフィルタリング機能を要求しない。
		const layout = wgpu.device.createBindGroupLayout({ entries: [
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			...[2, 3, 4, 5].map(binding => ({
				binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' as const },
			})),
		] });

		const pipeline = wgpu.device.createRenderPipeline({
			vertex: {
				module: wgpu.defaultVertexShaderModule,
			},
			fragment: {
				module: shaderModule,
				targets: [{
					format: wgpu.enableFloat32Filtering ? 'r32float' : 'r16float',
				}],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: wgpu.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
		});

		const uniformValues = makeStructuredView(shaderDataDefinitions.uniforms.uniforms);

		const uniformBuffer = wgpu.device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		uniformValues.set({ aspectRatio: resolution.width / resolution.height });
		wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
		let textures: GPUTexture[] = [];
		let bindGroup: GPUBindGroup;

		return {
			render: (ctx) => {
				const inputs = [ctx.params.scale, ctx.params.outputMin, ctx.params.outputMax, ctx.params.time];
				if (inputs.some((texture, i) => texture !== textures[i])) {
					textures = inputs;
					bindGroup = wgpu.device.createBindGroup({ layout, entries: [
						{ binding: 1, resource: { buffer: uniformBuffer } },
						...textures.map((texture, i) => ({ binding: i + 2, resource: texture.createView() })),
					] });
				}

				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.draw(6);
				passEncoder.end();
			},
			dispose: () => {
				uniformBuffer.destroy();
			},
		};
	},
});
