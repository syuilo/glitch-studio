import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	disableCache: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, enable32bitDataTextures, intermediateTextureFormat }, resolution }) => {
		// 出力のアルファが0でもRGBの履歴を失わないよう、未乗算のRGBを別の履歴に保持する。
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const historyTextures = Array.from({ length: 2 }, () => device.createTexture({
			size: resolution,
			format: historyFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}));
		const historyViews = historyTextures.map(texture => texture.createView());
		const layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
			],
		});
		const pipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code,
			schema: { input: 'color', strengthFactor: 'color', halfLifeFactor: 'color' },
			internalLayouts: [layout],
			constants: {
				MAX_VALUE: enable32bitDataTextures ? 3.402823466e38 : 65504,
				MAX_OUTPUT_VALUE: intermediateTextureFormat === 'rgba16float' ? 65504 : 1,
			},
			targets: [{ format: intermediateTextureFormat }, { format: historyFormat }],
		});
		const values = new Float32Array(5);
		const uniforms = device.createBuffer({
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const groups = historyViews.map(view => device.createBindGroup({
			layout,
			entries: [
				{ binding: 0, resource: { buffer: uniforms } },
				{ binding: 1, resource: view },
			],
		}));
		let previousIndex = 0;
		let hasPrevious = false;
		return {
			render: ctx => {
				// 係数は画素ごとに異なるため、積分と減衰はシェーダー側で計算する。
				values[0] = Number.isFinite(ctx.timeDelta) ? Math.max(0, ctx.timeDelta / 1000) : 0;
				values[1] = !ctx.params.reset ? Math.max(0, ctx.params.strength) : 0;
				values[2] = Math.max(0, ctx.params.halfLife) / 1000;
				values[3] = hasPrevious && !ctx.params.reset ? 1 : 0;
				values[4] = ctx.params.mode === 'interpolate' ? 1 : 0;
				device.queue.writeBuffer(uniforms, 0, values);
				const variant = pipelines.update({
					input: ctx.params.input,
					strengthFactor: ctx.params.strengthFactor,
					halfLifeFactor: ctx.params.halfLifeFactor,
				}, ctx.outputDataMap.output.texture);
				const nextIndex = 1 - previousIndex;
				const render = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: [
						{ view: ctx.outputDataMap.output.textureView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
						{ view: historyViews[nextIndex], loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
					],
				});
				render.setPipeline(variant.pipeline);
				render.setBindGroup(0, groups[previousIndex]);
				render.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				render.draw(6);
				render.end();
				previousIndex = nextIndex;
				hasPrevious = true;
			},
			dispose: () => {
				pipelines.dispose();
				uniforms.destroy();
				for (const texture of historyTextures) texture.destroy();
			},
		};
	},
});
