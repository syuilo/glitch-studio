import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import maskCode from './mask.wgsl?raw';
import distanceCode from './distance.wgsl?raw';
import compositeCode from './composite.wgsl?raw';
import surfaceWavinessCode from './surface-waviness.wgsl?raw';
import refractionCode from './refraction.wgsl?raw';
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
		const { device } = wgpu;
		const scalarFormat = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		const seedFormat = wgpu.enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const createTexture = (format: GPUTextureFormat) => {
			const texture = device.createTexture({ size: resolution, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			return { texture, view: texture.createView() };
		};
		const mask = createTexture(scalarFormat);
		const seeds = [createTexture(seedFormat), createTexture(seedFormat)];
		const distance = createTexture(scalarFormat);
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } };
		const textureEntry = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
		const maskLayout = device.createBindGroupLayout({ entries: [uniformEntry] });
		const distanceLayout = device.createBindGroupLayout({ entries: [uniformEntry, textureEntry(1), textureEntry(2), { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const compositeLayout = device.createBindGroupLayout({ entries: [uniformEntry, textureEntry(1), textureEntry(2), { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
		const maskPipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code: commonCode + '\n' + maskCode,
			schema: { mask: 'scalar' }, targets: [{ format: scalarFormat }], internalLayouts: [maskLayout],
			entryPoint: 'prepareMask', sampling: 'level0',
		});
		const distanceModule = device.createShaderModule({ code: commonCode + '\n' + distanceCode });
		const createDistancePipeline = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [distanceLayout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: distanceModule, entryPoint, targets: [{ format }] },
			primitive: { topology: 'triangle-list' },
		});
		const boundaryPipeline = createDistancePipeline('boundarySeed', seedFormat);
		const jumpPipeline = createDistancePipeline('jumpFlood', seedFormat);
		const distancePipeline = createDistancePipeline('signedDistance', scalarFormat);
		const compositePipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code: [commonCode, surfaceWavinessCode, refractionCode, compositeCode].join('\n'),
			schema: { background: 'color' }, targets: [{ format: wgpu.intermediateTextureFormat }], internalLayouts: [compositeLayout],
			entryPoint: 'composite', sampling: 'level0',
		});
		const uniformResource = { binding: 0, resource: { buffer: uniformBuffer } };
		const maskGroup = device.createBindGroup({ layout: maskLayout, entries: [uniformResource] });
		const jumpSteps: number[] = [];
		for (let step = 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(resolution.width, resolution.height))) - 1); step >= 1; step /= 2) jumpSteps.push(step);
		// JFA+1で近似誤差を減らす。全ての形状で厳密な距離になるわけではない。
		jumpSteps.push(1);
		const jumpBuffers = jumpSteps.map(step => {
			// submit前のwriteBufferは全パスに同じ最終値を見せるため、歩幅ごとにbufferを所有する。
			const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			device.queue.writeBuffer(buffer, 0, new Uint32Array([step]));
			return buffer;
		});
		const createDistanceGroup = (seedIndex: number, jumpIndex: number) => device.createBindGroup({
			layout: distanceLayout,
			entries: [uniformResource, { binding: 1, resource: mask.view }, { binding: 2, resource: seeds[seedIndex].view }, { binding: 3, resource: { buffer: jumpBuffers[jumpIndex] } }],
		});
		// 境界生成時も有効なbindingを渡すが、描画先のseedと同じtextureはbindしない。
		const boundaryGroup = createDistanceGroup(1, 0);
		const jumpGroups = jumpSteps.map((_, index) => createDistanceGroup(index % 2, index));
		const distanceGroup = createDistanceGroup(jumpSteps.length % 2, 0);
		const compositeGroup = device.createBindGroup({
			layout: compositeLayout,
			entries: [uniformResource, { binding: 1, resource: mask.view }, { binding: 2, resource: distance.view }, { binding: 3, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) }],
		});
		const draw = (pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, group: GPUBindGroup) => {
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(6);
			pass.end();
		};
		const clampParameter = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
		return {
			render: ctx => {
				const time = Number.isFinite(ctx.params.time) ? ctx.params.time : 0;
				const surfaceWavinessSpeed = clampParameter(ctx.params.surfaceWavinessSpeed, -10, 10, 0.3);
				uniformValues.set({
					size: [resolution.width, resolution.height],
					bevelWidth: clampParameter(ctx.params.bevelWidth, 0, 2, 0.12),
					surfaceHeight: clampParameter(ctx.params.surfaceHeight, 0, 2, 0.06),
					refractionStrength: clampParameter(ctx.params.refractionStrength, -2, 2, 0.08),
					highlightStrength: clampParameter(ctx.params.highlightStrength, 0, 10, 0.8),
					blurRadius: clampParameter(ctx.params.blurRadius, 0, 1, 0),
					// 対称なサンプル対を使うので、式などから渡された奇数も近い偶数へ揃える。
					blurSamples: 2 * Math.round(clampParameter(ctx.params.blurSamples, 4, 64, 24) / 2),
					dispersion: clampParameter(ctx.params.dispersion, 0, 1, 0),
					surfaceWavinessAmplitude: clampParameter(ctx.params.surfaceWavinessAmplitude, 0, 1, 0),
					surfaceWavinessScale: clampParameter(ctx.params.surfaceWavinessScale, 0.01, 10, 0.3),
					surfaceWavinessTime: time * surfaceWavinessSpeed,
					surfaceWavinessSeed: Math.trunc(clampParameter(ctx.params.surfaceWavinessSeed, -2147483648, 4294967295, 0)) >>> 0,
					lightDirection: ctx.params.lightDirection.map(value => clampParameter(value, -10, 10, 0)),
					tint: [...ctx.params.tint.slice(0, 3), clampParameter(ctx.params.tint[3], 0, 1, 0)],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const maskVariant = maskPipelines.update({ mask: ctx.params.mask }, resolution);
				const maskPass = ctx.createPassEncoderFor(ctx.commandEncoder, mask.view);
				maskPass.setPipeline(maskVariant.pipeline);
				maskPass.setBindGroup(0, maskGroup);
				maskPass.setBindGroup(maskPipelines.inputGroup, maskVariant.bindGroup);
				maskPass.draw(6);
				maskPass.end();
				draw(ctx.createPassEncoderFor(ctx.commandEncoder, seeds[0].view), boundaryPipeline, boundaryGroup);
				for (let index = 0; index < jumpGroups.length; index++) {
					draw(ctx.createPassEncoderFor(ctx.commandEncoder, seeds[(index + 1) % 2].view), jumpPipeline, jumpGroups[index]);
				}
				draw(ctx.createPassEncoderFor(ctx.commandEncoder, distance.view), distancePipeline, distanceGroup);
				const compositeVariant = compositePipelines.update({ background: ctx.params.background }, resolution);
				const compositePass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				compositePass.setPipeline(compositeVariant.pipeline);
				compositePass.setBindGroup(0, compositeGroup);
				compositePass.setBindGroup(compositePipelines.inputGroup, compositeVariant.bindGroup);
				compositePass.draw(6);
				compositePass.end();
			},
			dispose: () => {
				maskPipelines.dispose();
				compositePipelines.dispose();
				uniformBuffer.destroy();
				for (const buffer of jumpBuffers) buffer.destroy();
				for (const image of [mask, ...seeds, distance]) image.texture.destroy();
			},
		};
	},
});
