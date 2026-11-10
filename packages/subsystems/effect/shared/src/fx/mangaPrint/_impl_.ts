import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import colorSpaceCode from '@gs/shared/gpu/color-space.wgsl?raw';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import lightnessInputCode from './lightness-input.wgsl?raw';
import prepareCode from './prepare.wgsl?raw';
import smoothCode from './smooth.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type definition from './_def_.ts';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule }, resolution }) => {
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const lightnessLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		// 平滑化に必要な明度×alphaとalphaだけを保持する。外部の色テクスチャとは区別する。
		const lightnessTextures = Array.from({ length: 2 }, () => device.createTexture({
			size: resolution, format: 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}));
		const lightnessViews = lightnessTextures.map(texture => texture.createView());
		const lightnessGroups = lightnessViews.map(view => device.createBindGroup({ layout: lightnessLayout, entries: [
			{ binding: 0, resource: view }, { binding: 1, resource: sampler },
		] }));
		const preparePipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: colorSpaceCode + '\n' + commonCode + '\n' + prepareCode,
			schema: { input: 'color' }, sampling: 'level0', internalLayouts: [uniformLayout], targets: [{ format: 'rg16float' }],
		});
		const smoothPipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout, lightnessLayout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: commonCode + '\n' + lightnessInputCode + '\n' + smoothCode }), targets: [{ format: 'rg16float' }] },
		});
		const outputPipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: colorSpaceCode + '\n' + commonCode + '\n' + lightnessInputCode + '\n' + outputCode,
			schema: { input: 'color' }, sampling: 'level0', internalLayouts: [uniformLayout, lightnessLayout], targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});

		return {
			render: ctx => {
				const params = ctx.params;
				const referencePixels = getSizeReferenceLength(params.sizeReference, resolution);
				const smoothing = clamp(params.smoothing, 0, 0.02);
				uniformValues.set({
					positionToReference: [resolution.width / (2 * referencePixels), resolution.height / (2 * referencePixels)],
					referenceToPosition: [2 * referencePixels / resolution.width, 2 * referencePixels / resolution.height],
					referencePixels,
					amount: clamp(params.amount, 0, 1),
					brightness: clamp(params.brightness, -1, 1),
					contrast: clamp(params.contrast, 0, 4),
					smoothing,
					// 通常は画素間隔以下でサンプルし、大きな半径でも処理量は各軸65点までに抑える。
					smoothingSteps: clamp(Math.ceil(2 * smoothing * referencePixels), 1, 32),
					levels: clamp(Math.round(params.levels), 2, 8),
					toneFrequency: clamp(params.toneFrequency, 1, 10000),
					toneAngle: (params.toneAngle % 1) * 2 * Math.PI,
					outlineSensitivity: clamp(params.outlineSensitivity, 0, 1),
					outlineWidth: clamp(params.outlineWidth, 0, 0.1),
					outlineStrength: clamp(params.outlineStrength, 0, 1),
					paperColor: params.paperColor,
					inkColor: params.inkColor,
					paperGrain: clamp(params.paperGrain, 0, 1),
					paperGrainFrequency: clamp(params.paperGrainFrequency, 1, 10000),
					seed: Math.trunc(params.seed) >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				if (params.amount > 0) {
					const prepared = preparePipelines.update({ input: params.input }, resolution);
					const preparePass = ctx.createPassEncoderFor(ctx.commandEncoder, lightnessViews[0]);
					preparePass.setPipeline(prepared.pipeline);
					preparePass.setBindGroup(0, uniformGroup);
					preparePass.setBindGroup(preparePipelines.inputGroup, prepared.bindGroup);
					preparePass.draw(3);
					preparePass.end();
					const smoothPass = ctx.createPassEncoderFor(ctx.commandEncoder, lightnessViews[1]);
					smoothPass.setPipeline(smoothPipeline);
					smoothPass.setBindGroup(0, uniformGroup);
					smoothPass.setBindGroup(1, lightnessGroups[0]);
					smoothPass.draw(3);
					smoothPass.end();
				}
				const output = outputPipelines.update({ input: params.input }, resolution);
				const outputPass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				outputPass.setPipeline(output.pipeline);
				outputPass.setBindGroup(0, uniformGroup);
				outputPass.setBindGroup(1, lightnessGroups[1]);
				outputPass.setBindGroup(outputPipelines.inputGroup, output.bindGroup);
				outputPass.draw(3);
				outputPass.end();
			},
			dispose: () => {
				preparePipelines.dispose();
				outputPipelines.dispose();
				uniformBuffer.destroy();
				for (const texture of lightnessTextures) texture.destroy();
			},
		};
	},
});
