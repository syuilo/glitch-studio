import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { constantShaderInput, createShaderInputBindings, generateShaderInputs } from '@gs/shared/gpu/shader-input.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode, { uniforms as commonUniforms, structs as commonStructs } from './common.wgsl?shader';
import updateCode from './update.wgsl?raw';
import renderCode from './render.wgsl?raw';
import composeCode from './compose.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import downsampleCode from './downsample.wgsl?raw';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		coverage: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution, fallbackTexture }) => {
		const { device, defaultVertexShaderModule } = wgpu;
		const uniformValues = createShaderBuffer(commonUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const computeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const renderLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		] });
		const composeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		] });
		const inactiveImage = constantShaderInput('color', [0, 0, 0, 0]);
		const fallbackView = fallbackTexture.createView();
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 16 });
		const textures: GPUTexture[] = [];
		const createTexture = (format: GPUTextureFormat, sampleCount = 1, mipLevelCount = 1) => {
			const texture = device.createTexture({ size: resolution, format, sampleCount, mipLevelCount,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | (sampleCount === 1 ? GPUTextureUsage.TEXTURE_BINDING : 0) });
			textures.push(texture);
			return texture;
		};
		const createSurface = (format: GPUTextureFormat) => ({
			multisampled: createTexture(format, 4).createView(),
			resolved: createTexture(format).createView(),
		});
		let coverageSurface: ReturnType<typeof createSurface> | null = null;
		let colorSurface: ReturnType<typeof createSurface> | null = null;
		let depthView: GPUTextureView | null = null;
		const capture = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: captureCode, schema: { inputA: 'color' },
			sampling: 'level0', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		const downsample = device.createRenderPipeline({
			layout: 'auto', vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: downsampleCode }), targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
			primitive: { topology: 'triangle-list' },
		});
		let image: { view: GPUTextureView; levels: GPUTextureView[]; groups: GPUBindGroup[] } | null = null;
		const prepareImage = () => {
			if (image != null) return image;
			const mipLevelCount = Math.floor(Math.log2(Math.max(resolution.width, resolution.height))) + 1;
			const texture = createTexture(INTERMEDIATE_TEXTURE_FORMAT, 1, mipLevelCount);
			const levels = Array.from({ length: mipLevelCount }, (_, baseMipLevel) => texture.createView({ baseMipLevel, mipLevelCount: 1 }));
			image = { view: texture.createView(), levels,
				groups: levels.slice(0, -1).map(view => device.createBindGroup({ layout: downsample.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }] })) };
			return image;
		};
		const computeVariants = new Map<ShaderInput['kind'], { pipeline: GPUComputePipeline; bindings: ReturnType<typeof createShaderInputBindings> }>();
		const getComputeVariant = (progress: ShaderInput) => {
			let variant = computeVariants.get(progress.kind);
			if (variant == null) {
				const generated = generateShaderInputs({ progress: 'scalar' }, { progress }, 1, 'level0');
				const bindings = createShaderInputBindings(device, generated);
				const pipeline = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: generated.code + '\n' + commonCode + '\n' + updateCode }), entryPoint: 'update' },
				});
				variant = { pipeline, bindings };
				computeVariants.set(progress.kind, variant);
			}
			return variant;
		};
		const renderVariants = new Map<string, { pipeline: GPURenderPipeline; bindings: ReturnType<typeof createShaderInputBindings> }>();
		const getRenderVariant = (inputA: ShaderInput, color: boolean) => {
			const key = `${color}:${inputA.kind}`;
			let variant = renderVariants.get(key);
			if (variant == null) {
				const generated = generateShaderInputs({ inputA: 'color' }, { inputA }, 1, 'level0');
				const bindings = createShaderInputBindings(device, generated);
				const module = device.createShaderModule({ code: generated.code + '\n' + commonCode + '\n' + renderCode });
				const pipeline = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout, bindings.layout] }),
					vertex: { module, entryPoint: 'vs' },
					fragment: { module, entryPoint: color ? 'fsColor' : 'fsCoverage', targets: color ? [{ format: INTERMEDIATE_TEXTURE_FORMAT }, { format: 'r16float' }] : [{ format: 'r16float' }] },
					primitive: { topology: 'triangle-list', cullMode: 'none' },
					depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
					multisample: { count: 4 },
				});
				variant = { pipeline, bindings };
				renderVariants.set(key, variant);
			}
			return variant;
		};
		const coverageFormat = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		type OutputMode = 'Color' | 'Coverage' | 'Both';
		const composeVariants = new Map<OutputMode, ReturnType<typeof createShaderInputPipeline>>();
		const getComposeVariant = (mode: OutputMode) => {
			let pipelines = composeVariants.get(mode);
			if (pipelines == null) {
				pipelines = createShaderInputPipeline({
					device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + composeCode,
					schema: { inputA: 'color', inputB: 'color' }, internalLayouts: [composeLayout], sampling: 'level0', entryPoint: `fs${mode}`,
					targets: mode === 'Both' ? [{ format: INTERMEDIATE_TEXTURE_FORMAT }, { format: coverageFormat }] : [{ format: mode === 'Color' ? INTERMEDIATE_TEXTURE_FORMAT : coverageFormat }],
				});
				composeVariants.set(mode, pipelines);
			}
			return pipelines;
		};
		let stateBuffer: GPUBuffer | null = null;
		let stateBufferSize = 0;
		return {
			render: ctx => {
				const colorOutput = ctx.outputDataMap.output;
				const coverageOutput = ctx.outputDataMap.coverage;
				if (colorOutput == null && coverageOutput == null) return;
				const params = ctx.params;
				const progress = params.progress.kind === 'uniform' ? params.progress.value[0] : null;
				const endpoint = progress != null && progress <= 0 ? 1 : progress != null && progress >= 1 ? 2 : 0;
				const halfExtent = getSpatialHalfExtent(resolution);
				const referenceScale = getSizeReferenceLength(params.sizeReference, resolution) / Math.max(resolution.width, resolution.height);
				const fragmentSize = Math.max(0.000001, params.fragmentSize * referenceScale);
				const grid = endpoint === 0 ? halfExtent.map(value => Math.max(1, Math.ceil(2 * value / fragmentSize))) : [1, 1];
				const fragmentCount = grid[0] * grid[1] * 2;
				const bufferSize = fragmentCount * commonStructs.FragmentState.byteLength;
				if (!Number.isSafeInteger(bufferSize) || bufferSize > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
					|| Math.ceil(fragmentCount / 64) > device.limits.maxComputeWorkgroupsPerDimension) {
					throw new Error('Shatter Transition: fragment grid exceeds GPU resource limits. Increase Fragment Size.');
				}
				uniformValues.set({
					halfExtent, center: params.center, grid,
					irregularity: Math.max(0, Math.min(1, params.irregularity)),
					spread: Math.max(0, params.spread) * referenceScale, depth: params.depth * referenceScale,
					rotation: params.rotation, gravity: params.gravity * referenceScale,
					stagger: Math.max(0, Math.min(1, params.stagger)), perspective: Math.max(0, Math.min(1, params.perspective)),
					shading: Math.max(0, Math.min(1, params.shading)), seed: params.seed >>> 0, endpoint,
					texturedA: Number(params.inputA.kind === 'texture'),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				if (endpoint === 0) {
					coverageSurface ??= createSurface('r16float');
					depthView ??= createTexture('depth24plus', 4).createView();
					if (colorOutput != null) colorSurface ??= createSurface(INTERMEDIATE_TEXTURE_FORMAT);
					if (colorOutput != null && params.inputA.kind === 'texture') {
						const currentImage = prepareImage();
						const variant = capture.update({ inputA: params.inputA }, resolution);
						const pass = ctx.createPassEncoderFor(ctx.commandEncoder, currentImage.levels[0]);
						pass.setPipeline(variant.pipeline); pass.setBindGroup(capture.inputGroup, variant.bindGroup); pass.draw(3); pass.end();
						for (let level = 1; level < currentImage.levels.length; level++) {
							const mipPass = ctx.createPassEncoderFor(ctx.commandEncoder, currentImage.levels[level]);
							mipPass.setPipeline(downsample); mipPass.setBindGroup(0, currentImage.groups[level - 1]); mipPass.draw(3); mipPass.end();
						}
					}
					if (stateBuffer == null || stateBufferSize !== bufferSize) {
						stateBuffer?.destroy();
						stateBuffer = device.createBuffer({ size: bufferSize, usage: GPUBufferUsage.STORAGE });
						stateBufferSize = bufferSize;
					}
					const stateEntry = { binding: 1, resource: { buffer: stateBuffer } };
					const compute = getComputeVariant(params.progress);
					const computePass = ctx.createComputePassEncoder(ctx.commandEncoder);
					computePass.setPipeline(compute.pipeline);
					computePass.setBindGroup(0, device.createBindGroup({ layout: computeLayout, entries: [uniformEntry, stateEntry] }));
					computePass.setBindGroup(1, compute.bindings.update({ progress: params.progress }, resolution));
					computePass.dispatchWorkgroups(Math.ceil(fragmentCount / 64)); computePass.end();
					const inputA = colorOutput == null ? inactiveImage : params.inputA;
					const variant = getRenderVariant(inputA, colorOutput != null);
					const surfaces = colorOutput == null ? [coverageSurface] : [colorSurface!, coverageSurface];
					const pass = ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: surfaces.map(surface => ({ view: surface.multisampled, resolveTarget: surface.resolved, loadOp: 'clear' as const, storeOp: 'discard' as const, clearValue: [0, 0, 0, 0] })),
						depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
					});
					pass.setPipeline(variant.pipeline);
					pass.setBindGroup(0, device.createBindGroup({ layout: renderLayout, entries: [uniformEntry, stateEntry, { binding: 2, resource: sampler }, { binding: 3, resource: image?.view ?? fallbackView }] }));
					pass.setBindGroup(1, variant.bindings.update({ inputA }, resolution));
					pass.draw(3, fragmentCount); pass.end();
				}
				const mode = colorOutput == null ? 'Coverage' : coverageOutput == null ? 'Color' : 'Both';
				const pipelines = getComposeVariant(mode);
				const variant = pipelines.update({ inputA: colorOutput == null ? inactiveImage : params.inputA, inputB: colorOutput == null ? inactiveImage : params.inputB }, resolution);
				const outputs = colorOutput == null ? [coverageOutput!] : coverageOutput == null ? [colorOutput] : [colorOutput, coverageOutput];
				const pass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: outputs.map(output => ({ view: output.textureView, loadOp: 'clear' as const, storeOp: 'store' as const })) });
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, device.createBindGroup({ layout: composeLayout, entries: [uniformEntry, { binding: 1, resource: colorSurface?.resolved ?? fallbackView }, { binding: 2, resource: coverageSurface?.resolved ?? fallbackView }] }));
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup); pass.draw(3); pass.end();
			},
			dispose: () => {
				for (const variant of computeVariants.values()) variant.bindings.dispose();
				for (const variant of renderVariants.values()) variant.bindings.dispose();
				for (const pipelines of composeVariants.values()) pipelines.dispose();
				for (const texture of textures) texture.destroy();
				capture.dispose(); stateBuffer?.destroy(); uniformBuffer.destroy();
			},
		};
	},
});
