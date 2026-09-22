import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition, 'shaderInput'>({
	inputMode: 'shaderInput',
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
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const options = {
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { startPosition: 'scalar', endPosition: 'scalar', startValue: 'scalar', endValue: 'scalar', frequency: 'scalar', phase: 'scalar', skew: 'scalar' },
			sampling: 'level0', scalarGradients: true,
		} as const;
		const scalarFormat = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		const scalarPipelines = createShaderInputPipeline({ ...options, internalLayouts: [layout], entryPoint: 'fs', targets: [{ format: scalarFormat }] });
		// vector未使用時は追加pipeline・入力bufferを生成せず、微分計算もoverrideで除去する。
		let gradientPipelines: ReturnType<typeof createShaderInputPipeline> | undefined;
		const getGradientPipelines = () => gradientPipelines ??= createShaderInputPipeline({
			...options, internalLayouts: [layout], entryPoint: 'fsWithGradient', constants: { CALCULATE_GRADIENT: 1 },
			targets: [{ format: scalarFormat }, { format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float' }],
		});

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
				const inputs = {
					startPosition: ctx.params.startPosition, endPosition: ctx.params.endPosition,
					startValue: ctx.params.startValue, endValue: ctx.params.endValue,
					frequency: ctx.params.frequency, phase: ctx.params.phase, skew: ctx.params.skew,
				};
				const needsGradient = ctx.usedOutputPorts?.has('vector') ?? true;
				const pipelines = needsGradient ? getGradientPipelines() : scalarPipelines;
				const variant = pipelines.update(inputs, ctx.outputDataMap.scalar.texture);

				const passEncoder = needsGradient
					? ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [ctx.outputDataMap.scalar.textureView, ctx.outputDataMap.vector.textureView].map(view => ({
							view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear' as const, storeOp: 'store' as const,
						})),
					})
					: ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.scalar.textureView);
				passEncoder.setPipeline(variant.pipeline);
				passEncoder.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.draw(6);
				passEncoder.end();
			},
			dispose: () => {
				scalarPipelines.dispose();
				gradientPipelines?.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
