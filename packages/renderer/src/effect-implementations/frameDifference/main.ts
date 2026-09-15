import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from '@glitch/shared/effect-definitions/frameDifference.ts';

export default implementEffect<typeof definition>({
	// Even a cached, unchanged input must settle back to a zero difference on the next frame.
	disableCache: true,
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat, enable32bitDataTextures }, resolution, params, fallbackTexture }) => {
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const module = device.createShaderModule({ code });
		const inputLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			],
		});
		const historyLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const difference = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [inputLayout, historyLayout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, entryPoint: 'difference', constants: { HALF_PRECISION: Number(!enable32bitDataTextures) }, targets: [{ format: intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const capture = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [inputLayout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, entryPoint: 'capture', constants: { HALF_PRECISION: Number(!enable32bitDataTextures) }, targets: [{ format: historyFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		// シェーダー側でも同じ保存精度に丸め、静止画に量子化由来の差分が出ないようにする。
		const history = device.createTexture({
			size: resolution,
			format: historyFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const historyView = history.createView();
		const values = new ArrayBuffer(12);
		const integers = new Uint32Array(values);
		const floats = new Float32Array(values);
		const uniforms = device.createBuffer({
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const historyGroup = device.createBindGroup({
			layout: historyLayout,
			entries: [
				{ binding: 0, resource: historyView },
				{ binding: 1, resource: { buffer: uniforms } },
			],
		});
		let input = params.input;
		const createInputGroup = () => device.createBindGroup({
			layout: inputLayout,
			entries: [
				{ binding: 0, resource: (input ?? fallbackTexture).createView() },
				{ binding: 1, resource: sampler },
			],
		});
		let inputGroup = createInputGroup();
		let hasPrevious = false;
		return {
			render: ctx => {
				if (ctx.params.input == null) {
					hasPrevious = false;
					ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView).end();
					return;
				}
				if (input !== ctx.params.input) {
					input = ctx.params.input;
					inputGroup = createInputGroup();
				}
				integers[0] = ctx.params.mode === 'luminance' ? 1 : 0;
				floats[1] = Math.max(0, ctx.params.gain);
				floats[2] = Math.max(0, ctx.params.threshold);
				device.queue.writeBuffer(uniforms, 0, values);
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				if (hasPrevious) {
					render.setPipeline(difference);
					render.setBindGroup(0, inputGroup);
					render.setBindGroup(1, historyGroup);
					render.draw(6);
				}
				render.end();
				// Save the input only after the previous input has been used for comparison.
				const save = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: [{
						view: historyView,
						clearValue: { r: 0, g: 0, b: 0, a: 1 },
						loadOp: 'clear', storeOp: 'store',
					}],
				});
				save.setPipeline(capture);
				save.setBindGroup(0, inputGroup);
				save.draw(6);
				save.end();
				hasPrevious = true;
			},
			dispose: () => {
				uniforms.destroy();
				history.destroy();
			},
		};
	},
});
