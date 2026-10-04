import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
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
				// 半減期0は即時減衰。加算の積分量は0、補間は現在の入力へ即座に追従する。
				let decay = 0;
				let integration = 0;
				let interpolation = 1;
				if (halfLife > 0) {
					const exponent = Math.LN2 * (seconds / halfLife);
					decay = Math.exp(-exponent);
					// 加算は dA/dt = strength * input - rate * A、補間は dA/dt = rate * (strength * input - A)。
					// expm1で短いフレーム間隔の桁落ちを避け、どちらも経過時間に基づいて計算する。
					interpolation = -Math.expm1(-exponent);
					integration = exponent > 0 ? (interpolation / Math.LN2) * halfLife : seconds;
				}
				// 補間の初回は比較する履歴がないため、Strength適用後の入力から始める。
				const inputWeight = ctx.params.mode === 'interpolate' ? (hasPrevious ? interpolation : 1) : integration;
				values[0] = hasPrevious && !ctx.params.reset ? decay : 0;
				values[1] = !ctx.params.reset ? inputWeight * Math.max(0, ctx.params.strength) : 0;
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
