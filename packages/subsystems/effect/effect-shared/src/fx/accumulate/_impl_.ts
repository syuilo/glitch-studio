import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	disableCache: true,
	needsPreviousFrame: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'rgba32float' : 'rgba16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, enable32bitDataTextures } }) => {
		// 履歴は入力接続と分離し、同一画素の厳密な読み取りを維持する。
		const layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
			],
		});
		const pipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code,
			schema: { input: 'any' },
			internalLayouts: [layout],
			// 入力の加算を行う分岐から呼ぶためLODを明示する。
			sampling: 'level0',
			constants: { MAX_VALUE: enable32bitDataTextures ? 3.402823466e38 : 65504 },
			targets: [{ format: enable32bitDataTextures ? 'rgba32float' : 'rgba16float' }],
		});
		const values = new Float32Array(2);
		const uniforms = device.createBuffer({
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		let hasPrevious = false;
		const groups = new Map<GPUTextureView, GPUBindGroup>();
		return {
			render: ctx => {
				const previous = ctx.outputDataMap.output.previousFrameTextureView!;
				let group = groups.get(previous);
				if (group == null) {
					group = device.createBindGroup({
						layout,
						entries: [
							{ binding: 0, resource: { buffer: uniforms } },
							{ binding: 1, resource: previous },
						],
					});
					groups.set(previous, group);
				}
				const seconds = Number.isFinite(ctx.timeDelta) ? Math.max(0, ctx.timeDelta / 1000) : 0;
				const halfLife = Math.max(0, ctx.params.halfLife) / 1000;
				const rate = halfLife > 0 ? Math.LN2 / halfLife : 0;
				const decay = Math.exp(-rate * seconds);
				// Exact integration of dA/dt = strength * input - rate * A for constant input.
				// expm1 preserves precision when the frame interval is small relative to the half-life.
				const integration = rate > 0 ? -Math.expm1(-rate * seconds) / rate : seconds;
				values[0] = hasPrevious && !ctx.params.reset ? decay : 0;
				// 未接続入力は0のuniformとして渡されるため、加算しても履歴に影響しない。
				values[1] = !ctx.params.reset ? integration * Math.max(0, ctx.params.strength) : 0;
				device.queue.writeBuffer(uniforms, 0, values);
				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				render.setPipeline(variant.pipeline);
				render.setBindGroup(0, group);
				render.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				render.draw(6);
				render.end();
				hasPrevious = true;
			},
			dispose: () => {
				pipelines.dispose();
				uniforms.destroy();
				groups.clear();
			},
		};
	},
});
