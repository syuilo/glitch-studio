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
			schema: { input: 'color' },
			internalLayouts: [layout],
			constants: {
				MAX_VALUE: enable32bitDataTextures ? 3.402823466e38 : 65504,
				MAX_OUTPUT_VALUE: intermediateTextureFormat === 'rgba16float' ? 65504 : 1,
			},
			targets: [{ format: intermediateTextureFormat }, { format: historyFormat }],
		});
		// WGSLのvec3fは16バイト境界に配置するため、各RGBの末尾に1成分分の余白を持たせる。
		const values = new Float32Array(8);
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
				const seconds = Number.isFinite(ctx.timeDelta) ? Math.max(0, ctx.timeDelta / 1000) : 0;
				// 係数のRGBだけを使い、アルファは蓄積量・減衰のどちらにも影響させない。
				for (let channel = 0; channel < 3; channel++) {
					const strength = Math.max(0, ctx.params.strength) * Math.max(0, ctx.params.strengthFactor[channel]);
					const halfLife = Math.max(0, ctx.params.halfLife) * Math.max(0, ctx.params.halfLifeFactor[channel]) / 1000;
					const rate = halfLife > 0 ? Math.LN2 / halfLife : 0;
					const decay = Math.exp(-rate * seconds);
					// 一定入力での dA/dt = strength * input - rate * A をチャンネルごとに厳密に積分し、FPSへの依存を防ぐ。
					// フレーム間隔が半減期に比べて短い場合も、expm1で桁落ちを避ける。
					const integration = rate > 0 ? -Math.expm1(-rate * seconds) / rate : seconds;
					values[channel] = hasPrevious && !ctx.params.reset ? decay : 0;
					values[4 + channel] = !ctx.params.reset ? integration * strength : 0;
				}
				device.queue.writeBuffer(uniforms, 0, values);
				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
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
