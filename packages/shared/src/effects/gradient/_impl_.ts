import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		scalar: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		vector: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const shaderModule = wgpu.device.createShaderModule({
			code: code,
		});

		const shaderDataDefinitions = makeShaderDataDefinitions(code);
		const sampler = wgpu.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const bindGroupLayout = wgpu.device.createBindGroupLayout({ entries: [
			{ binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			...[1, 2, 3, 4, 5, 6, 7].map(binding => ({
				binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' as const },
			})),
		] });

		const pipeline = wgpu.device.createRenderPipeline({
			vertex: {
				module: wgpu.defaultVertexShaderModule,
			},
			fragment: {
				module: shaderModule,
				entryPoint: 'fs',
				targets: [{
					format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
				}],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: wgpu.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		});

		// 勾配を使うまで追加パイプラインも作成しない。
		let gradientPipeline: GPURenderPipeline | undefined;
		const getGradientPipeline = () => gradientPipeline ??= wgpu.device.createRenderPipeline({
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: {
				module: shaderModule,
				entryPoint: 'fsWithGradient',
				constants: { CALCULATE_GRADIENT: 1 },
				targets: [
					{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' },
					{ format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float' },
				],
			},
			primitive: { topology: 'triangle-list' },
			layout: wgpu.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		});

		const uniformValues = makeStructuredView(shaderDataDefinitions.uniforms.uniforms);

		const uniformBuffer = wgpu.device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		let textures: GPUTexture[] = [];
		let bindGroup: GPUBindGroup;

		return {
			render: (ctx) => {
				uniformValues.set({
					aspectRatio: resolution.width / resolution.height,
					mode: ctx.params.mode === 'radial' ? 1 : 0,
					center: ctx.params.center,
					fitMode: { stretch: 0, cover: 1, contain: 2 }[ctx.params.fitMode],
					angle: ctx.params.angle * Math.PI, // 正の角度で時計回り
					clampEdge: ctx.params.clampEdge ? 1 : 0,
					mirrorRepeat: ctx.params.mirrorRepeat ? 1 : 0,
					interpolation: { linear: 0, smoothstep: 1, smootherstep: 2, cosine: 3, circular: 4, back: 5, elastic: 6, expo: 7, 'expo-in': 8, 'expo-out': 9 }[ctx.params.interpolation],
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const inputs = [ctx.params.startPosition, ctx.params.endPosition, ctx.params.startValue, ctx.params.endValue, ctx.params.frequency, ctx.params.phase, ctx.params.skew];
				if (inputs.some((texture, i) => texture !== textures[i])) {
					textures = inputs;
					bindGroup = wgpu.device.createBindGroup({
						layout: bindGroupLayout,
						entries: [
							{ binding: 8, resource: sampler },
							{ binding: 0, resource: { buffer: uniformBuffer } },
							...textures.map((texture, i) => ({ binding: i + 1, resource: texture.createView() })),
						],
					});
				}

				const needsGradient = ctx.usedOutputPorts?.has('vector') ?? true;
				const passEncoder = needsGradient
					? ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [ctx.outputDataMap.scalar.textureView, ctx.outputDataMap.vector.textureView].map(view => ({
							view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear' as const, storeOp: 'store' as const,
						})),
					})
					: ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.scalar.textureView);
				passEncoder.setPipeline(needsGradient ? getGradientPipeline() : pipeline);
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
