import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	// Even a cached, unchanged input must settle back to a zero difference on the next frame.
	disableCache: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat, enable32bitDataTextures }, resolution }) => {
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const historyLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const inputOptions = {
			device, vertex: defaultVertexShaderModule, code,
			schema: { input: 'color' }, sampling: 'level0',
			constants: { HALF_PRECISION: Number(!enable32bitDataTextures) },
		} as const;
		const difference = createShaderInputPipeline({ ...inputOptions, internalLayouts: [historyLayout], entryPoint: 'difference', targets: [{ format: intermediateTextureFormat }] });
		// captureでは書き込み先の履歴を読み取りbindingに含めない。
		const emptyLayout = device.createBindGroupLayout({ entries: [] });
		const emptyGroup = device.createBindGroup({ layout: emptyLayout, entries: [] });
		const capture = createShaderInputPipeline({ ...inputOptions, internalLayouts: [emptyLayout], entryPoint: 'capture', targets: [{ format: historyFormat }] });
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
		let hasPrevious = false;
		return {
			render: ctx => {
				// 未接続を表す透明な定数では、従来どおり出力と履歴状態をリセットする。
				if (ctx.params.input.kind === 'uniform' && ctx.params.input.value.every(value => value === 0)) {
					hasPrevious = false;
					ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView).end();
					return;
				}
				integers[0] = ctx.params.mode === 'luminance' ? 1 : 0;
				floats[1] = Math.max(0, ctx.params.gain);
				floats[2] = Math.max(0, ctx.params.threshold);
				device.queue.writeBuffer(uniforms, 0, values);
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				if (hasPrevious) {
					const variant = difference.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
					render.setPipeline(variant.pipeline);
					render.setBindGroup(0, historyGroup);
					render.setBindGroup(difference.inputGroup, variant.bindGroup);
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
				const variant = capture.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				save.setPipeline(variant.pipeline);
				save.setBindGroup(0, emptyGroup);
				save.setBindGroup(capture.inputGroup, variant.bindGroup);
				save.draw(6);
				save.end();
				hasPrevious = true;
			},
			dispose: () => {
				difference.dispose();
				capture.dispose();
				uniforms.destroy();
				history.destroy();
			},
		};
	},
});
