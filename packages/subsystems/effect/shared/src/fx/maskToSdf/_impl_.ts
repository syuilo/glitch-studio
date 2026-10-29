import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import prepareCode from './prepare.wgsl?raw';
import seedCode from './seed.wgsl?raw';
import distanceCode from './distance.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const scalarFormat = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		const offsetFormat = wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float';
		const createTexture = (format: GPUTextureFormat) => {
			const texture = device.createTexture({ size: resolution, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			return { texture, view: texture.createView() };
		};
		const mask = createTexture(scalarFormat);
		const offsets = createTexture(offsetFormat);
		// IDは浮動小数点データではなく画素の識別子。精度設定に関係なく整数で保持する。
		const identifiers = [createTexture('r32uint'), createTexture('r32uint')];
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } };
		const uniformResource = { binding: 0, resource: { buffer: uniformBuffer } };
		const prepareLayout = device.createBindGroupLayout({ entries: [uniformEntry] });
		const seedLayout = device.createBindGroupLayout({ entries: [uniformEntry, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
		const distanceLayout = device.createBindGroupLayout({ entries: [
			uniformEntry,
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
			{ binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const preparePipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule,
			code: commonCode + '\n' + prepareCode, schema: { input: 'scalar' },
			sampling: 'level0', internalLayouts: [prepareLayout], entryPoint: 'prepare', targets: [{ format: scalarFormat }],
			constants: { MAX_MASK_DIFFERENCE: wgpu.enable32bitDataTextures ? 3.4028234663852886e38 : 65504 },
		});
		const createPipeline = (code: string, entryPoint: string, layout: GPUBindGroupLayout, formats: GPUTextureFormat[]) => device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: commonCode + '\n' + code }), entryPoint, targets: formats.map(format => ({ format })) },
		});
		const seedPipeline = createPipeline(seedCode, 'seed', seedLayout, ['r32uint', offsetFormat]);
		const jumpPipeline = createPipeline(distanceCode, 'jumpFlood', distanceLayout, ['r32uint']);
		const distancePipeline = createPipeline(distanceCode, 'distanceField', distanceLayout, [scalarFormat]);
		const prepareGroup = device.createBindGroup({ layout: prepareLayout, entries: [uniformResource] });
		const seedGroup = device.createBindGroup({ layout: seedLayout, entries: [uniformResource, { binding: 1, resource: mask.view }] });
		const jumpSteps: number[] = [];
		for (let step = 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(resolution.width, resolution.height))) - 1); step >= 1; step /= 2) jumpSteps.push(step);
		jumpSteps.push(1); // JFA+1。最後に隣接画素でもう一度伝播し、近似誤差を減らす。
		const distanceGroupEntries = [uniformResource, { binding: 1, resource: mask.view }, { binding: 2, resource: offsets.view }];
		const jumpPasses = jumpSteps.map((step, index) => {
			// 同じbufferを各パスの前にwriteBufferすると、全パスが最後の値を読む。
			// 歩幅ごとにbufferを確保し、描画中は変更しない。
			const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			device.queue.writeBuffer(buffer, 0, new Uint32Array([step]));
			const group = device.createBindGroup({ layout: distanceLayout, entries: [...distanceGroupEntries,
				{ binding: 3, resource: identifiers[index % 2].view }, { binding: 4, resource: { buffer } },
			] });
			return { buffer, group, target: identifiers[(index + 1) % 2].view };
		});
		const distanceGroup = device.createBindGroup({ layout: distanceLayout, entries: [...distanceGroupEntries,
			{ binding: 3, resource: identifiers[jumpSteps.length % 2].view }, { binding: 4, resource: { buffer: jumpPasses[0].buffer } },
		] });
		const draw = (pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, group: GPUBindGroup) => {
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(6);
			pass.end();
		};
		return {
			render: ctx => {
				uniformValues.set({ size: [resolution.width, resolution.height], threshold: ctx.params.threshold, invert: ctx.params.invert ? 1 : 0 });
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const prepared = preparePipelines.update({ input: ctx.params.input }, resolution);
				const preparePass = ctx.createPassEncoderFor(ctx.commandEncoder, mask.view);
				preparePass.setPipeline(prepared.pipeline);
				preparePass.setBindGroup(0, prepareGroup);
				preparePass.setBindGroup(preparePipelines.inputGroup, prepared.bindGroup);
				preparePass.draw(6);
				preparePass.end();
				const seedPass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [identifiers[0].view, offsets.view].map(view => ({ view, loadOp: 'clear', storeOp: 'store' })) });
				draw(seedPass, seedPipeline, seedGroup);
				for (const { group, target } of jumpPasses) draw(ctx.createPassEncoderFor(ctx.commandEncoder, target), jumpPipeline, group);
				draw(ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView), distancePipeline, distanceGroup);
			},
			dispose: () => {
				preparePipelines.dispose();
				uniformBuffer.destroy();
				for (const { buffer } of jumpPasses) buffer.destroy();
				for (const { texture } of [mask, offsets, ...identifiers]) texture.destroy();
			},
		};
	},
});
