import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { constantShaderInput, inputUvScale, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode, { uniforms as commonUniforms } from './common.wgsl?shader';
import prepareCode from './prepare.wgsl?raw';
import smoothCode from './smooth.wgsl?raw';
import gradientCode from './gradient.wgsl?raw';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, enable32bitDataTextures }, resolution }) => {
		const scalarFormat = enable32bitDataTextures ? 'r32float' : 'r16float';
		const uniformValues = createShaderBuffer(commonUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelineOptions = {
			device, vertex: defaultVertexShaderModule, internalLayouts: [uniformLayout], sampling: 'level0' as const,
		};
		const preparePipelines = createShaderInputPipeline({
			...pipelineOptions, code: commonCode + '\n' + prepareCode,
			schema: { input: 'color' }, targets: [{ format: scalarFormat }],
		});
		const smoothPipelines = [true, false].map(horizontal => createShaderInputPipeline({
			...pipelineOptions, code: commonCode + '\n' + smoothCode,
			schema: { luminance: 'scalar' }, targets: [{ format: scalarFormat }], constants: { HORIZONTAL: Number(horizontal) },
		}));
		const gradientPipelines = createShaderInputPipeline({
			...pipelineOptions, code: commonCode + '\n' + gradientCode,
			schema: { luminance: 'scalar' }, scalarGradients: true,
			targets: [{ format: enable32bitDataTextures ? 'rg32float' : 'rg16float' }],
		});
		let intermediate: { width: number; height: number; textures: GPUTexture[]; views: GPUTextureView[] } | null = null;

		function ensureIntermediate(width: number, height: number) {
			if (intermediate == null || intermediate.width !== width || intermediate.height !== height) {
				for (const texture of intermediate?.textures ?? []) texture.destroy();
				// 入力の原寸で輝度を保持する。先に出力サイズへ切り取ると、CoverやRepeatの
				// 領域外にある色をぼかしへ取り込めず、画面端の勾配が不自然になる。
				const textures = Array.from({ length: 2 }, () => device.createTexture({
					size: [width, height], format: scalarFormat,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				}));
				intermediate = { width, height, textures, views: textures.map(texture => texture.createView()) };
			}
			return intermediate;
		}

		return {
			render: ctx => {
				const draw = (variant: ReturnType<typeof gradientPipelines.update>, inputGroup: number, view: GPUTextureView) => {
					const pass = ctx.createPassEncoderFor(ctx.commandEncoder, view);
					pass.setPipeline(variant.pipeline);
					pass.setBindGroup(0, uniformGroup);
					pass.setBindGroup(inputGroup, variant.bindGroup);
					pass.draw(3);
					pass.end();
				};
				const { input, blurRadius, sizeReference, strength, normalize, alphaMode } = ctx.params;
				const sigmaPixels = Math.max(0, blurRadius) * getSizeReferenceLength(sizeReference, resolution);
				const fitScale = input.kind === 'texture' ? inputUvScale(input.texture, resolution, input.fitMode) : [1, 1];
				const blurSigma = [2 * sigmaPixels / resolution.width * fitScale[0], 2 * sigmaPixels / resolution.height * fitScale[1]];
				const source = input.kind === 'texture' ? input.texture : resolution;
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution), blurSigma,
					// ±3sigmaを画素間隔以下で標本化し、各軸最大65点で処理量に上限を設ける。
					blurSteps: [source.width * blurSigma[0], source.height * blurSigma[1]].map(diameter => Math.max(1, Math.min(32, Math.ceil(1.5 * diameter)))),
					strength, normalize: normalize ? 1 : 0, ignoreAlpha: alphaMode === 'ignore' ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				// 定数は空間的に一様。画像の境界を作らず、輝度・ぼかし用textureも確保しない。
				let luminanceInput: ShaderInput = constantShaderInput('scalar', 0);
				if (input.kind === 'texture') {
					const buffers = ensureIntermediate(input.texture.width, input.texture.height);
					const sourceSampling = { fitMode: 'stretch', wrapMode: input.wrapMode, filterMode: input.filterMode } as const;
					const prepared = preparePipelines.update({ input: textureShaderInput(input.texture, sourceSampling) }, buffers.textures[0]);
					draw(prepared, preparePipelines.inputGroup, buffers.views[0]);
					if (sigmaPixels > 0) {
						for (const [axis, pipelines] of smoothPipelines.entries()) {
							const smoothed = pipelines.update({ luminance: textureShaderInput(buffers.textures[axis], sourceSampling) }, buffers.textures[1 - axis]);
							draw(smoothed, pipelines.inputGroup, buffers.views[1 - axis]);
						}
					}
					// Fitは最終的な勾配の参照時に適用する。ぼかしの寸法だけ先にFitを換算済み。
					luminanceInput = textureShaderInput(buffers.textures[0], input);
				}
				const gradient = gradientPipelines.update({ luminance: luminanceInput }, ctx.outputDataMap.output.texture);
				draw(gradient, gradientPipelines.inputGroup, ctx.outputDataMap.output.textureView);
			},
			dispose: () => {
				preparePipelines.dispose();
				for (const pipelines of smoothPipelines) pipelines.dispose();
				gradientPipelines.dispose();
				uniformBuffer.destroy();
				for (const texture of intermediate?.textures ?? []) texture.destroy();
			},
		};
	},
});
