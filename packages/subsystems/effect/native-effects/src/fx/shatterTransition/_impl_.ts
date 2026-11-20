import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { beginOutputPass, bindParameterValues, createFixedInputPipeline } from '../../multipass.ts';
import { createFixedInputBindings } from '../../shader-input.ts';
import commonCode, { uniforms as commonUniforms, structs as commonStructs } from './common.wgsl?shader';
import updateCode from './update.wgsl?raw';
import renderCode from './render.wgsl?raw';
import composeCode from './compose.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import downsampleCode from './downsample.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, 'inputA' | 'inputB' | 'shading'> = {
	init(context) {
		const { resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const fallbackTexture = context.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
		const { device, defaultVertexShaderModule } = context;
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
		const inactiveImage = { kind: 'uniform', value: [0, 0, 0, 0] } as const;
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
		const colorOutput = outputTextures.get('output');
		const coverageOutput = outputTextures.get('coverage');
		const color = colorOutput != null;
		const inputA = color ? params.inputA! : inactiveImage;
		const inputB = color ? params.inputB! : inactiveImage;
		const mode = !color ? 'Coverage' : coverageOutput == null ? 'Color' : 'Both';
		const coverageFormat = context.enable32bitDataTextures ? 'r32float' : 'r16float';
		const coverageSurface = createSurface('r16float');
		const colorSurface = color ? createSurface(INTERMEDIATE_TEXTURE_FORMAT) : null;
		const depthView = createTexture('depth24plus', 4).createView();
		const outputs = [colorOutput, coverageOutput].filter(texture => texture != null);
		const outputPass: GPURenderPassDescriptor = { colorAttachments: outputs.map(texture => ({ view: texture.createView(), loadOp: 'clear', storeOp: 'store' })) };
		const surfaces = colorSurface == null ? [coverageSurface] : [colorSurface, coverageSurface];
		const geometryPass: GPURenderPassDescriptor = {
			colorAttachments: surfaces.map(surface => ({ view: surface.multisampled, resolveTarget: surface.resolved, loadOp: 'clear', storeOp: 'discard' })),
			depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
		};
		const composeGroup = device.createBindGroup({ layout: composeLayout, entries: [uniformEntry,
																																																																																	{ binding: 1, resource: colorSurface?.resolved ?? fallbackView }, { binding: 2, resource: coverageSurface.resolved },
		] });

		function createMipChain() {
			const capture = createFixedInputPipeline({ inputA }, resolution, {
				device, vertex: defaultVertexShaderModule, code: captureCode, schema: { inputA: 'color' },
				sampling: 'level0', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			});
			const downsample = device.createRenderPipeline({
				layout: 'auto', vertex: { module: defaultVertexShaderModule },
				fragment: { module: device.createShaderModule({ code: downsampleCode }), targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
				primitive: { topology: 'triangle-list' },
			});
			const mipLevelCount = Math.floor(Math.log2(Math.max(resolution.width, resolution.height))) + 1;
			const texture = createTexture(INTERMEDIATE_TEXTURE_FORMAT, 1, mipLevelCount);
			const levels = Array.from({ length: mipLevelCount }, (_, baseMipLevel) => texture.createView({ baseMipLevel, mipLevelCount: 1 }));
			return { capture, downsample, view: texture.createView(), levels,
												groups: levels.slice(0, -1).map(view => device.createBindGroup({ layout: downsample.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }] })) };
		}

		const image = inputA.kind === 'texture' ? createMipChain() : null;
		const computeInputs = createFixedInputBindings(device, { progress: 'scalar' }, params, resolution, 1, 'level0');
		const computePipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, computeInputs.layout] }),
			compute: { module: device.createShaderModule({ code: computeInputs.code + '\n' + commonCode + '\n' + updateCode }), entryPoint: 'update' },
		});
		const renderInputs = createFixedInputBindings(device, { inputA: 'color' }, { inputA }, resolution, 1, 'level0');
		const module = device.createShaderModule({ code: renderInputs.code + '\n' + commonCode + '\n' + renderCode });
		const renderPipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout, renderInputs.layout] }),
			vertex: { module, entryPoint: 'vs' },
			fragment: { module, entryPoint: color ? 'fsColor' : 'fsCoverage', targets: color ? [{ format: INTERMEDIATE_TEXTURE_FORMAT }, { format: 'r16float' }] : [{ format: 'r16float' }] },
			primitive: { topology: 'triangle-list', cullMode: 'none' },
			depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
			multisample: { count: 4 },
		});
		const compose = createFixedInputPipeline({ inputA, inputB }, resolution, {
			device, vertex: defaultVertexShaderModule, code: commonCode + '\n' + composeCode,
			schema: { inputA: 'color', inputB: 'color' }, internalLayouts: [composeLayout], sampling: 'level0', entryPoint: `fs${mode}`,
			targets: mode === 'Both' ? [{ format: INTERMEDIATE_TEXTURE_FORMAT }, { format: coverageFormat }] : [{ format: mode === 'Color' ? INTERMEDIATE_TEXTURE_FORMAT : coverageFormat }],
		});

		function createState(size: number) {
			const buffer = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE });
			const stateEntry = { binding: 1, resource: { buffer } };
			return { buffer, size,
												computeGroup: device.createBindGroup({ layout: computeLayout, entries: [uniformEntry, stateEntry] }),
												renderGroup: device.createBindGroup({ layout: renderLayout, entries: [uniformEntry, stateEntry,
																																																																																		{ binding: 2, resource: sampler }, { binding: 3, resource: image?.view ?? fallbackView },
												] }),
			};
		}

		let state: ReturnType<typeof createState> | null = null;
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
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
					shading: Math.max(0, Math.min(1, params.shading ?? 0)), seed: params.seed >>> 0, endpoint,
					texturedA: Number(inputA.kind === 'texture'),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				if (endpoint === 0) {
					if (image != null) {
						const pass = beginOutputPass(commandEncoder, image.levels[0]);
						pass.setPipeline(image.capture.pipeline); pass.setBindGroup(image.capture.inputGroup, image.capture.getBindGroup()); pass.draw(3); pass.end();
						for (let level = 1; level < image.levels.length; level++) {
							const mipPass = beginOutputPass(commandEncoder, image.levels[level]);
							mipPass.setPipeline(image.downsample); mipPass.setBindGroup(0, image.groups[level - 1]); mipPass.draw(3); mipPass.end();
						}
					}
					if (state?.size !== bufferSize) {
						const replacement = createState(bufferSize);
						state?.buffer.destroy();
						state = replacement;
					}
					const computePass = commandEncoder.beginComputePass();
					computePass.setPipeline(computePipeline);
					computePass.setBindGroup(0, state.computeGroup);
					computePass.setBindGroup(1, computeInputs.getBindGroup());
					computePass.dispatchWorkgroups(Math.ceil(fragmentCount / 64)); computePass.end();
					const pass = commandEncoder.beginRenderPass(geometryPass);
					pass.setPipeline(renderPipeline);
					pass.setBindGroup(0, state.renderGroup);
					pass.setBindGroup(1, renderInputs.getBindGroup());
					pass.draw(3, fragmentCount); pass.end();
				}
				const pass = commandEncoder.beginRenderPass(outputPass);
				pass.setPipeline(compose.pipeline);
				pass.setBindGroup(0, composeGroup);
				pass.setBindGroup(compose.inputGroup, compose.getBindGroup());
				pass.draw(3); pass.end();
			},
			dispose: () => {
				fallbackTexture.destroy();
				for (const texture of textures) texture.destroy();
				image?.capture.dispose(); computeInputs.dispose(); renderInputs.dispose(); compose.dispose();
				state?.buffer.destroy(); uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
