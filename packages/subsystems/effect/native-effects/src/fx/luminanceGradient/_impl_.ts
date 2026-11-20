import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { inputUvScale } from '@gs/shared/gpu/shader-input.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { beginOutputPass, bindParameterValues, createFixedInputPipeline, intermediateTextureInput } from '../../multipass.ts';
import commonCode, { uniforms as commonUniforms } from './common.wgsl?shader';
import prepareCode from './prepare.wgsl?raw';
import smoothCode from './smooth.wgsl?raw';
import gradientCode from './gradient.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const scalarFormat = enable32bitDataTextures ? 'r32float' : 'r16float';
		const uniformValues = createShaderBuffer(commonUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelineOptions = {
			device, vertex: defaultVertexShaderModule, internalLayouts: [uniformLayout], sampling: 'level0' as const,
		};
		const { input } = params;
		// 入力の原寸でぼかし、Fitは最終的な勾配を読むときに適用する。
		const textures = input.kind === 'texture' ? Array.from({ length: 2 }, () => device.createTexture({
			size: input.resolution, format: scalarFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		})) : [];
		const views = textures.map(texture => texture.createView());
		const prepare = input.kind === 'texture' ? createFixedInputPipeline({ input: {
			kind: 'texture', resolution: input.resolution, get texture() { return input.texture; },
			fitMode: 'stretch', wrapMode: input.wrapMode, filterMode: input.filterMode,
		} }, input.resolution, {
			...pipelineOptions, code: commonCode + '\n' + prepareCode,
			schema: { input: 'color' }, targets: [{ format: scalarFormat }],
		}) : null;
		const smooth = input.kind === 'texture' ? textures.map((texture, axis) => createFixedInputPipeline({
			luminance: intermediateTextureInput(texture, { fitMode: 'stretch', wrapMode: input.wrapMode, filterMode: input.filterMode }),
		}, input.resolution, {
			...pipelineOptions, code: commonCode + '\n' + smoothCode, schema: { luminance: 'scalar' },
			targets: [{ format: scalarFormat }], constants: { HORIZONTAL: Number(axis === 0) },
		})) : [];
		const gradient = createFixedInputPipeline({ luminance: input.kind === 'texture' ? intermediateTextureInput(textures[0], input) : { kind: 'uniform', value: [0] } }, resolution, {
			...pipelineOptions, code: commonCode + '\n' + gradientCode, schema: { luminance: 'scalar' }, scalarGradients: true,
			targets: [{ format: enable32bitDataTextures ? 'rg32float' : 'rg16float' }],
		});
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const draw = (stage: typeof gradient, view: GPUTextureView) => {
					const pass = beginOutputPass(commandEncoder, view);
					pass.setPipeline(stage.pipeline);
					pass.setBindGroup(0, uniformGroup);
					pass.setBindGroup(stage.inputGroup, stage.getBindGroup());
					pass.draw(3);
					pass.end();
				};
				const { blurRadius, sizeReference, strength, normalize, alphaMode } = params;
				const sigmaPixels = Math.max(0, blurRadius) * getSizeReferenceLength(sizeReference, resolution);
				const fitScale = input.kind === 'texture' ? inputUvScale(input.resolution, resolution, input.fitMode) : [1, 1];
				const blurSigma = [2 * sigmaPixels / resolution.width * fitScale[0], 2 * sigmaPixels / resolution.height * fitScale[1]];
				const source = input.kind === 'texture' ? input.resolution : resolution;
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution), blurSigma,
					// ±3sigmaを画素間隔以下で標本化し、各軸最大65点で処理量に上限を設ける。
					blurSteps: [source.width * blurSigma[0], source.height * blurSigma[1]].map(diameter => Math.max(1, Math.min(32, Math.ceil(1.5 * diameter)))),
					strength, normalize: normalize ? 1 : 0, ignoreAlpha: alphaMode === 'ignore' ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				if (prepare != null) {
					draw(prepare, views[0]);
					if (sigmaPixels > 0) {
						for (const [axis, stage] of smooth.entries()) draw(stage, views[1 - axis]);
					}
				}
				draw(gradient, outputView);
			},
			dispose: () => {
				prepare?.dispose();
				for (const pipelines of smooth) pipelines.dispose();
				gradient.dispose();
				uniformBuffer.destroy();
				for (const texture of textures) texture.destroy();
			},
		};
	},
};

export default implementation;
