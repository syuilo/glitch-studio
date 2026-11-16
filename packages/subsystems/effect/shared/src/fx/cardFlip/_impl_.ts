import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import captureCode from './capture.wgsl?raw';
import downsampleCode from './downsample.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution, fallbackTexture }) => {
		const { device } = wgpu;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		] });
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 16 });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { inputA: 'color', inputB: 'color', background: 'color', progress: 'scalar' },
			sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		const downsample = device.createRenderPipeline({
			layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: downsampleCode }), targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
			primitive: { topology: 'triangle-list' },
		});
		const mipLevelCount = Math.floor(Math.log2(Math.max(resolution.width, resolution.height))) + 1;
		// A/Bは別の入力bufferを持つ。同じbufferを2回updateすると、command実行時には
		// 両方とも最後の値を読むため、capture用pipelineも面ごとに所有する。
		const faces = ['inputA', 'inputB'].map(() => ({
			capture: createShaderInputPipeline({
				device, vertex: wgpu.defaultVertexShaderModule, code: captureCode,
				schema: { input: 'color' }, sampling: 'level0', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			}),
			texture: null as GPUTexture | null,
			view: fallbackTexture.createView(),
			levels: [] as GPUTextureView[],
			downsampleGroups: [] as GPUBindGroup[],
		}));
		const createBindGroup = () => device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: sampler },
			{ binding: 2, resource: faces[0].view },
			{ binding: 3, resource: faces[1].view },
		] });
		let bindGroup = createBindGroup();
		return {
			render: ctx => {
				const inputs = [ctx.params.inputA, ctx.params.inputB];
				const progress = ctx.params.progress.kind === 'uniform' ? ctx.params.progress.value[0] : null;
				for (const [index, face] of faces.entries()) {
					// 定数色は直接読む。端点・真横・裏に隠れた面にも縮小画像を作らない。
					if (inputs[index].kind !== 'texture' || (progress != null && (progress <= 0 || progress >= 1 || progress === 0.5 || (index === 0 ? progress > 0.5 : progress < 0.5)))) continue;
					if (face.texture == null) {
						face.texture = device.createTexture({ size: resolution, mipLevelCount, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
						face.view = face.texture.createView();
						face.levels = Array.from({ length: mipLevelCount }, (_, baseMipLevel) => face.texture!.createView({ baseMipLevel, mipLevelCount: 1 }));
						face.downsampleGroups = face.levels.slice(0, -1).map(view => device.createBindGroup({ layout: downsample.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }] }));
						bindGroup = createBindGroup();
					}
					const capture = face.capture.update({ input: inputs[index] }, resolution);
					const capturePass = ctx.createPassEncoderFor(ctx.commandEncoder, face.levels[0]);
					capturePass.setPipeline(capture.pipeline);
					capturePass.setBindGroup(face.capture.inputGroup, capture.bindGroup);
					capturePass.draw(3); capturePass.end();
					for (let level = 1; level < mipLevelCount; level++) {
						const pass = ctx.createPassEncoderFor(ctx.commandEncoder, face.levels[level]);
						pass.setPipeline(downsample);
						pass.setBindGroup(0, face.downsampleGroups[level - 1]);
						pass.draw(3); pass.end();
					}
				}
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution),
					axis: { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] }[ctx.params.flipDirection],
					pixelSize: 1 / Math.max(resolution.width, resolution.height),
					perspective: Math.max(0, Math.min(1, ctx.params.perspective)),
					shading: Math.max(0, Math.min(1, ctx.params.shading)),
					texturedA: Number(inputs[0].kind === 'texture'),
					texturedB: Number(inputs[1].kind === 'texture'),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ inputA: inputs[0], inputB: inputs[1], background: ctx.params.background, progress: ctx.params.progress }, resolution);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3); pass.end();
			},
			dispose: () => {
				for (const face of faces) { face.capture.dispose(); face.texture?.destroy(); }
				pipelines.dispose(); uniformBuffer.destroy();
			},
		};
	},
});
