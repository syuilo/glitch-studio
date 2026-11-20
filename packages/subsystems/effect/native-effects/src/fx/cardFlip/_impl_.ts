import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { beginOutputPass, bindParameterValues, createFixedInputPipeline } from '../../multipass.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import captureCode from './capture.wgsl?raw';
import downsampleCode from './downsample.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const fallbackTexture = context.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
		const { device } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		] });
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 16 });
		const pipelines = createFixedInputPipeline(params, context.resolution, {
			device, vertex: context.defaultVertexShaderModule, code,
			schema: { inputA: 'color', inputB: 'color', background: 'color', progress: 'scalar' },
			sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		const downsample = device.createRenderPipeline({
			layout: 'auto', vertex: { module: context.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: downsampleCode }), targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
			primitive: { topology: 'triangle-list' },
		});
		const mipLevelCount = Math.floor(Math.log2(Math.max(resolution.width, resolution.height))) + 1;
		// A/Bは別の入力bufferを持つ。同じbufferを2回updateすると、command実行時には
		// 両方とも最後の値を読むため、capture用pipelineも面ごとに所有する。
		const inputs = [params.inputA, params.inputB];
		const faces = inputs.map(input => {
			if (input.kind === 'uniform') return null;
			const capture = createFixedInputPipeline({ input }, resolution, {
				device, vertex: context.defaultVertexShaderModule, code: captureCode,
				schema: { input: 'color' }, sampling: 'level0', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			});
			const texture = device.createTexture({ size: resolution, mipLevelCount, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			const levels = Array.from({ length: mipLevelCount }, (_, baseMipLevel) => texture.createView({ baseMipLevel, mipLevelCount: 1 }));
			const downsampleGroups = levels.slice(0, -1).map(view => device.createBindGroup({ layout: downsample.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }] }));
			return { texture, view: texture.createView(), levels, downsampleGroups, capture };
		});
		const fallbackView = fallbackTexture.createView();
		const bindGroup = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: sampler },
			{ binding: 2, resource: faces[0]?.view ?? fallbackView },
			{ binding: 3, resource: faces[1]?.view ?? fallbackView },
		] });
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const progress = params.progress.kind === 'uniform' ? params.progress.value[0] : null;
				for (const [index, face] of faces.entries()) {
					// 定数色は直接読む。端点・真横・裏に隠れた面にも縮小画像を作らない。
					if (face == null || (progress != null && (progress <= 0 || progress >= 1 || progress === 0.5 || (index === 0 ? progress > 0.5 : progress < 0.5)))) continue;

					const capturePass = beginOutputPass(commandEncoder, face.levels[0]);
					capturePass.setPipeline(face.capture.pipeline);
					capturePass.setBindGroup(face.capture.inputGroup, face.capture.getBindGroup());
					capturePass.draw(3); capturePass.end();
					for (let level = 1; level < mipLevelCount; level++) {
						const pass = beginOutputPass(commandEncoder, face.levels[level]);
						pass.setPipeline(downsample);
						pass.setBindGroup(0, face.downsampleGroups[level - 1]);
						pass.draw(3); pass.end();
					}
				}
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution),
					axis: { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] }[params.flipDirection],
					pixelSize: 1 / Math.max(resolution.width, resolution.height),
					perspective: Math.max(0, Math.min(1, params.perspective)),
					shading: Math.max(0, Math.min(1, params.shading)),
					texturedA: Number(inputs[0].kind === 'texture'),
					texturedB: Number(inputs[1].kind === 'texture'),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const pass = beginOutputPass(commandEncoder, outputView);
				pass.setPipeline(pipelines.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, pipelines.getBindGroup());
				pass.draw(3); pass.end();
			},
			dispose: () => {
				fallbackTexture.destroy();
				for (const face of faces) { face?.capture.dispose(); face?.texture.destroy(); }
				pipelines.dispose(); uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
