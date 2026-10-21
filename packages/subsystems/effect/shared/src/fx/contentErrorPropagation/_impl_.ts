import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import propagationCode from './propagation.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type definition from './_def_.ts';

const flowModes = { contour: 0, gradient: 1, fixed: 2 };
const errorModes = { rgb: 0, luminance: 1, chroma: 2 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat, enable32bitDataTextures }, resolution }) => {
		const dataFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const captureLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const captureGroup = device.createBindGroup({ layout: captureLayout, entries: [uniformEntry] });
		const colorEntries: GPUBindGroupLayoutEntry[] = [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		];
		const colorLayout = device.createBindGroupLayout({ entries: colorEntries });
		const propagationLayout = device.createBindGroupLayout({
			entries: [
				...colorEntries,
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
				{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			],
		});
		const outputLayout = device.createBindGroupLayout({ entries: colorEntries });
		const capturePipelines = createShaderInputPipeline({
			device,
			vertex: defaultVertexShaderModule,
			code: commonCode + '\n' + captureCode,
			schema: { input: 'color' },
			targets: [{ format: dataFormat }],
			internalLayouts: [captureLayout],
			sampling: 'level0',
			entryPoint: 'capture',
		});
		const outputPipelines = createShaderInputPipeline({
			device,
			vertex: defaultVertexShaderModule,
			code: commonCode + '\n' + outputCode,
			schema: { input: 'color' },
			targets: [{ format: intermediateTextureFormat }],
			internalLayouts: [outputLayout],
			sampling: 'level0',
		});
		const propagationModule = device.createShaderModule({ code: commonCode + '\n' + propagationCode });
		const createPipeline = (entryPoint: string, layout: GPUBindGroupLayout) => device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module: propagationModule, entryPoint, targets: [{ format: dataFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const analyze = createPipeline('analyze', colorLayout);
		const initialize = createPipeline('initialize_error', colorLayout);
		const propagate = createPipeline('propagate', propagationLayout);
		// 誤差と方向は連続した場なので、補間して読む。アプリの32bit設定では
		// float32-filterableが有効であり、16bitへの独自フォールバックは不要。
		const sampler = device.createSampler({
			minFilter: 'linear',
			magFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});
		const samplerEntry = { binding: 1, resource: sampler };

		const getGeometry = (value: number) => {
			if (!Number.isFinite(value) || value < 1) throw new Error('Content error propagation: analysis resolution must be a finite number of at least 1.');
			const analysisResolution = Math.round(value);
			const shortSide = Math.min(resolution.width, resolution.height);
			const virtualSize = [resolution.width / shortSide * analysisResolution, resolution.height / shortSide * analysisResolution];
			const width = Math.ceil(virtualSize[0]);
			const height = Math.ceil(virtualSize[1]);
			if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
				|| width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D) {
				throw new Error('Content error propagation: analysis image exceeds GPU texture limits. Reduce Analysis resolution.');
			}
			return {
				analysisResolution,
				virtualSize,
				width,
				height,
			};
		};
		const createResources = (geometry: ReturnType<typeof getGeometry>) => {
			const textures: GPUTexture[] = [];
			const createTexture = () => {
				const texture = device.createTexture({
					size: { width: geometry.width, height: geometry.height },
					format: dataFormat,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				textures.push(texture);
				return texture.createView();
			};
			try {
				const capturedColorView = createTexture();
				const guidanceView = createTexture();
				const errorViews = [createTexture(), createTexture()];
				const capturedColorEntry = { binding: 2, resource: capturedColorView };
				return {
					width: geometry.width,
					height: geometry.height,
					capturedColorView,
					guidanceView,
					errorViews,
					colorGroup: device.createBindGroup({ layout: colorLayout, entries: [uniformEntry, samplerEntry, capturedColorEntry] }),
					propagationGroups: errorViews.map(view => device.createBindGroup({
						layout: propagationLayout,
						entries: [uniformEntry, samplerEntry, capturedColorEntry, { binding: 3, resource: guidanceView }, { binding: 4, resource: view }],
					})),
					outputGroups: errorViews.map(view => device.createBindGroup({
						layout: outputLayout,
						entries: [uniformEntry, samplerEntry, { binding: 2, resource: view }],
					})),
					dispose: () => { for (const texture of textures) texture.destroy(); },
				};
			} catch (error) {
				for (const texture of textures) texture.destroy();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);

		return {
			render: ctx => {
				const params = ctx.params;
				const geometry = getGeometry(params.analysisResolution);
				if (resources == null || resources.width !== geometry.width || resources.height !== geometry.height) {
					const next = createResources(geometry);
					resources?.dispose();
					resources = next;
				}
				const steps = clamp(Math.round(params.steps), 1, 256);
				const propagationLength = Math.max(0, params.propagationLength) / 100;
				const retention = clamp(params.retention, 0, 1);
				const sourceProbability = clamp(params.sourceProbability, 0, 1);
				const sourceSize = clamp(params.sourceSize, 0, 1);
				const angle = params.angle * Math.PI;
				seedValue[0] = params.seed;
				uniformValues.set({
					virtualSize: geometry.virtualSize,
					textureSize: [geometry.width, geometry.height],
					fallbackDirection: [Math.cos(angle), -Math.sin(angle)],
					analysisResolution: geometry.analysisResolution,
					stepDistance: propagationLength * geometry.analysisResolution / steps,
					// 全距離を進んだときの減衰を指定し、反復数を変えても同じ保持率を目指す。
					stepDecay: Math.pow(retention, 1 / steps),
					sourceSpacing: Math.max(0.000001, params.sourceSpacing / 100),
					sourceSize,
					sourceProbability,
					guidanceRadius: Math.max(0.000001, params.guidanceRadius / 100 * geometry.analysisResolution),
					following: clamp(params.following, 0, 1),
					boundaryThreshold: Math.max(0.000001, params.boundaryThreshold),
					boundaryStrength: clamp(params.boundaryStrength, 0, 1),
					flowMode: flowModes[params.flowMode],
					errorMode: errorModes[params.errorMode],
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const outputTexture = ctx.outputDataMap.output.texture;
				let current = 0;
				if (sourceProbability > 0 && sourceSize > 0) {
					// fitは最終出力の寸法を基準とし、解析用テクスチャの切り上げには影響させない。
					const capture = capturePipelines.update({ input: params.input }, outputTexture);
					const attachment = (view: GPUTextureView): GPURenderPassDescriptor => ({
						colorAttachments: [{
							view,
							clearValue: {
								r: 0,
								g: 0,
								b: 0,
								a: 0,
							},
							loadOp: 'clear',
							storeOp: 'store',
						}],
					});
					const capturePass = ctx.createPassEncoder(ctx.commandEncoder, attachment(resources.capturedColorView));
					capturePass.setPipeline(capture.pipeline);
					capturePass.setBindGroup(0, captureGroup);
					capturePass.setBindGroup(capturePipelines.inputGroup, capture.bindGroup);
					capturePass.draw(6);
					capturePass.end();
					const draw = (pipeline: GPURenderPipeline, group: GPUBindGroup, view: GPUTextureView) => {
						const pass = ctx.createPassEncoder(ctx.commandEncoder, attachment(view));
						pass.setPipeline(pipeline);
						pass.setBindGroup(0, group);
						pass.draw(6);
						pass.end();
					};
					draw(initialize, resources.colorGroup, resources.errorViews[0]);
					if (propagationLength > 0 && retention > 0) {
						draw(analyze, resources.colorGroup, resources.guidanceView);
						// 反復はこのフレームの初期誤差から開始する。前フレームの結果を再利用しない。
						for (let step = 0; step < steps; step++) {
							const next = 1 - current;
							draw(propagate, resources.propagationGroups[current], resources.errorViews[next]);
							current = next;
						}
					}
				}
				const output = outputPipelines.update({ input: params.input }, outputTexture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(output.pipeline);
				pass.setBindGroup(0, resources.outputGroups[current]);
				pass.setBindGroup(outputPipelines.inputGroup, output.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				resources?.dispose();
				capturePipelines.dispose();
				outputPipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
