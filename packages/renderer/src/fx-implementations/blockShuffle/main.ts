import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../fx-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from '@glitch/shared/fx-definitions/blockShuffle.ts';

const fitModes = { stretch: 0, cover: 1, contain: 2 };

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu, resolution, params, fallbackTexture }) => {
		const shaderModule = wgpu.device.createShaderModule({ code });
		// Sizeの32bitデータテクスチャはフィルタリングせず読み取る。
		const layout = wgpu.device.createBindGroupLayout({ entries: [
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		] });
		const pipeline = wgpu.device.createRenderPipeline({
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: {
				module: shaderModule,
				targets: [{ format: wgpu.intermediateTextureFormat }],
			},
			primitive: { topology: 'triangle-list' },
			layout: wgpu.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
		});
		const shaderDataDefinitions = makeShaderDataDefinitions(code);
		const uniformValues = makeStructuredView(shaderDataDefinitions.uniforms.uniforms);
		const uniformBuffer = wgpu.device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const sampler = wgpu.device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'mirror-repeat',
			addressModeV: 'mirror-repeat',
		});

		let inputTexture = params.input;
		let sizeTexture = params.size;
		let bindGroup: GPUBindGroup;
		const updateBindGroup = () => {
			bindGroup = wgpu.device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 1, resource: { buffer: uniformBuffer } },
					{ binding: 2, resource: sampler },
					{ binding: 3, resource: (inputTexture ?? fallbackTexture).createView() },
					{ binding: 4, resource: sizeTexture.createView() },
				],
			});
		};
		updateBindGroup();

		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);

		return {
			render: (ctx) => {
				if (ctx.params.input !== inputTexture || ctx.params.size !== sizeTexture) {
					inputTexture = ctx.params.input;
					sizeTexture = ctx.params.size;
					updateBindGroup();
				}

				seedValue[0] = ctx.params.seed;
				uniformValues.set({
					resolution: [resolution.width, resolution.height],
					fitMode: fitModes[ctx.params.fitMode],
					randomRotation: ctx.params.randomRotation ? 1 : 0,
					randomFlipX: ctx.params.randomFlipX ? 1 : 0,
					randomFlipY: ctx.params.randomFlipY ? 1 : 0,
					amount: Math.min(1, Math.max(0, ctx.params.amount)),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.draw(6);
				passEncoder.end();
			},
			dispose: () => uniformBuffer.destroy(),
		};
	},
});
