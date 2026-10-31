import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
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
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformBindGroupLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformBindGroup = device.createBindGroup({ layout: uniformBindGroupLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: {
				input: 'color',
				direction: 'scalar',
				phase: 'scalar',
				frequency: 'scalar',
				amplitude: 'scalar',
				chromaticAberrationStrength: 'scalar',
			},
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [uniformBindGroupLayout],
			// 色収差の強度による画素ごとの早期returnと、サンプリングループでLODを明示する。
			sampling: 'level0',
		});

		return {
			render: ctx => {
				const chromaticAberrationSamples = ctx.params.chromaticAberrationSamples;
				const referenceLength = getSizeReferenceLength(ctx.params.sizeReference, resolution);
				uniformValues.set({
					aspect: [resolution.width / referenceLength, resolution.height / referenceLength],
					// 両端の赤・青と中央の緑に重みを持たせるには最低3点必要。
					// 式からの値も整数化し、描画負荷が際限なく増えないよう上限を設ける。
					chromaticAberrationSamples: Number.isFinite(chromaticAberrationSamples)
						? Math.min(64, Math.max(3, Math.round(chromaticAberrationSamples))) : 16,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({
					input: ctx.params.input,
					direction: ctx.params.direction,
					phase: ctx.params.phase,
					frequency: ctx.params.frequency,
					amplitude: ctx.params.amplitude,
					chromaticAberrationStrength: ctx.params.chromaticAberrationStrength,
				}, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, uniformBindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
