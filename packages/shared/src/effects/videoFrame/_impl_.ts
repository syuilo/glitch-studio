import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createVideoFrameLoader } from './frame-loader.ts';
import { openVideoFrameSource } from './video-source.ts';
import type definition from './_def_.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution, params, reportStatus }) => {
		const shaderModule = wgpu.device.createShaderModule({ code });
		const pipeline = wgpu.device.createRenderPipeline({
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: shaderModule, targets: [{ format: wgpu.intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
			layout: 'auto',
		});
		const uniforms = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = wgpu.device.createBuffer({
			size: uniforms.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const sampler = wgpu.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
		let sourceTexture: GPUTexture | null = null;
		let bindGroup: GPUBindGroup | null = null;
		let cacheVersion = 0;
		// DOMに依存せず、回転・ピクセル比の補正をMediabunnyのdrawに任せる。
		let canvas: OffscreenCanvas | null = null;
		const loader = createVideoFrameLoader({
			open: openVideoFrameSource,
			reportStatus,
			publish: sample => {
				sourceTexture?.destroy();
				sourceTexture = null;
				bindGroup = null;
				++cacheVersion;
				if (sample == null) return;
				const width = Math.max(1, Math.round(sample.displayWidth));
				const height = Math.max(1, Math.round(sample.displayHeight));
				canvas ??= new OffscreenCanvas(width, height);
				if (canvas.width !== width) canvas.width = width;
				if (canvas.height !== height) canvas.height = height;
				const context = canvas.getContext('2d');
				if (context == null) throw new Error('Could not create a video frame canvas.');
				context.clearRect(0, 0, width, height);
				sample.draw(context, 0, 0, width, height);
				sourceTexture = wgpu.device.createTexture({
					size: { width, height },
					format: wgpu.intermediateTextureFormat,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				// Canvasから乗算済みRGBAとしてコピーする。シェーダーで再乗算せず、そのまま補間する。
				wgpu.device.queue.copyExternalImageToTexture(
					{ source: canvas },
					{ texture: sourceTexture, premultipliedAlpha: true },
					{ width, height },
				);
				bindGroup = wgpu.device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						{ binding: 1, resource: sampler },
						{ binding: 2, resource: sourceTexture.createView() },
					],
				});
			},
		});
		const prepare = (nextParams: typeof params) => loader.prepare(nextParams.asset?.fileData ?? null, nextParams.time, nextParams.outOfRange);
		prepare(params);
		return {
			get cacheVersion() { return cacheVersion; },
			prepare,
			render: ctx => {
				prepare(ctx.params);
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: [{
						view: ctx.outputDataMap.output.textureView,
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
						loadOp: 'clear', storeOp: 'store',
					}],
				});
				if (sourceTexture != null && bindGroup != null) {
					uniforms.set({
						aspectRatio: resolution.width / resolution.height,
						sourceAspectRatio: sourceTexture.width / sourceTexture.height,
						mode: ctx.params.fit === 'cover' ? 1 : ctx.params.fit === 'contain' ? 2 : 0,
					});
					wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(6);
				}
				pass.end();
			},
			dispose: () => {
				loader.dispose();
				sourceTexture?.destroy();
				uniformBuffer.destroy();
				if (canvas != null) { canvas.width = 1; canvas.height = 1; }
				canvas = null;
			},
		};
	},
});
