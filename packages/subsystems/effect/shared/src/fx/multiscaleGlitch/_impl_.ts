import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { inputUvScale } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import filterCode from './filter.wgsl?raw';
import compositeCode from './composite.wgsl?raw';
import type definition from './_def_.ts';

const nonNegative = (value: number, fallback: number) => Number.isFinite(value) ? Math.max(0, value) : fallback;
const unit = (value: number, fallback: number) => Math.min(1, nonNegative(value, fallback));
const displacement = (value: readonly number[]) => value.map(component => nonNegative(component, 0));

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution, fallbackTexture }) => {
		const { device, defaultVertexShaderModule } = wgpu;
		const shortSide = Math.min(resolution.width, resolution.height);
		const aspect = [resolution.width / shortSide, resolution.height / shortSide];
		// 帯域間の差分に8bitの丸めが重ならないよう、分解中は浮動小数点で保持する。
		const internalFormat = wgpu.enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const captureLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const captureGroup = device.createBindGroup({ layout: captureLayout, entries: [uniformEntry] });
		const compositeLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			],
		});
		const filterLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			],
		});
		const sampler = device.createSampler({
			minFilter: 'linear',
			magFilter: 'linear',
			addressModeU: 'mirror-repeat',
			addressModeV: 'mirror-repeat',
		});
		const samplerEntry = { binding: 1, resource: sampler };
		// downsampleはstepを参照しないが、Gaussianと同じlayoutを使うためゼロのbufferを渡す。
		const zeroStepBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM });
		const filterModule = device.createShaderModule({ code: filterCode });
		const createFilterPipeline = (entryPoint: string) => device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [filterLayout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module: filterModule, entryPoint, targets: [{ format: internalFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const downsample = createFilterPipeline('downsample');
		const gaussian = createFilterPipeline('gaussian');
		const inputOptions = {
			device,
			vertex: defaultVertexShaderModule,
			schema: { input: 'color' },
			sampling: 'level0',
		} as const;
		const capturePipelines = createShaderInputPipeline({
			...inputOptions,
			code: commonCode + '\n' + captureCode,
			internalLayouts: [captureLayout],
			entryPoint: 'capture',
			targets: [{ format: internalFormat }],
		});
		const compositePipelines = createShaderInputPipeline({
			...inputOptions,
			code: commonCode + '\n' + compositeCode,
			internalLayouts: [compositeLayout],
			entryPoint: 'fs',
			targets: [{ format: wgpu.intermediateTextureFormat }],
		});
		const createCompositeGroup = (fine: GPUTextureView, coarse: GPUTextureView) => device.createBindGroup({
			layout: compositeLayout,
			entries: [uniformEntry, samplerEntry, { binding: 2, resource: fine }, { binding: 3, resource: coarse }],
		});
		const fallbackView = fallbackTexture.createView();
		const fallbackGroup = createCompositeGroup(fallbackView, fallbackView);
		const createResources = (fineSize: number, coarseSize: number) => {
			const textures: GPUTexture[] = [];
			const buffers: GPUBuffer[] = [];
			const dispose = () => {
				for (const texture of textures) texture.destroy();
				for (const buffer of buffers) buffer.destroy();
			};
			const createImage = (size: number) => {
				const width = Math.max(1, Math.round(size * aspect[0]));
				const height = Math.max(1, Math.round(size * aspect[1]));
				if (width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D) {
					// 設定によって決まる帯域を勝手に変えない。小さすぎるスケールでは明示的に失敗させる。
					throw new Error('Multiscale glitch: working image exceeds GPU texture limits. Increase Fine scale.');
				}
				const texture = device.createTexture({ size: [width, height], format: internalFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
				textures.push(texture);
				return { texture, view: texture.createView() };
			};
			const createFilterGroup = (source: GPUTextureView, stepBuffer: GPUBuffer) => device.createBindGroup({
				layout: filterLayout,
				entries: [{ binding: 0, resource: { buffer: stepBuffer } }, samplerEntry, { binding: 2, resource: source }],
			});
			const createBlur = (source: GPUTextureView, size: number) => {
				const intermediate = createImage(size);
				const output = createImage(size);
				const createStepBuffer = () => {
					const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
					buffers.push(buffer);
					return buffer;
				};
				const horizontalStep = createStepBuffer();
				const verticalStep = createStepBuffer();
				return {
					output,
					// 各pass専用のuniformを持ち、submit前のwriteBufferで別passの方向を上書きしない。
					passes: [
						{
							view: intermediate.view,
							group: createFilterGroup(source, horizontalStep),
							stepBuffer: horizontalStep,
							axis: [1, 0],
						},
						{
							view: output.view,
							group: createFilterGroup(intermediate.view, verticalStep),
							stepBuffer: verticalStep,
							axis: [0, 1],
						},
					],
				};
			};
			try {
				const levels = [createImage(fineSize)];
				let size = fineSize;
				// 広い帯域を一度に間引くとaliasingを起こすため、最大1/2ずつ縮小する。
				while (size > coarseSize) {
					size = Math.max(coarseSize, Math.ceil(size / 2));
					levels.push(createImage(size));
				}
				const fine = createBlur(levels[0].view, fineSize);
				const coarse = createBlur(levels[levels.length - 1].view, coarseSize);
				return {
					fineSize,
					coarseSize,
					levels,
					fine,
					coarse,
					downGroups: levels.slice(0, -1).map(level => createFilterGroup(level.view, zeroStepBuffer)),
					compositeGroup: createCompositeGroup(fine.output.view, coarse.output.view),
					dispose,
				};
			} catch (error) {
				dispose();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		return {
			render: ctx => {
				const params = ctx.params;
				const probability = unit(params.probability, 0.4);
				const colorCorruption = unit(params.colorCorruption, 0.25);
				const fineShift = displacement(params.fineShift);
				const mediumShift = displacement(params.mediumShift);
				const coarseShift = displacement(params.coarseShift);
				const bandAmount = (enabled: boolean, value: number, shift: readonly number[]) => enabled && (colorCorruption > 0 || shift.some(component => component > 0)) ? nonNegative(value, 1) : 0;
				const bandAmounts = [
					bandAmount(params.fineEnabled, params.fineAmount, fineShift),
					bandAmount(params.mediumEnabled, params.mediumAmount, mediumShift),
					bandAmount(params.coarseEnabled, params.coarseAmount, coarseShift),
				];
				const active = probability > 0 && bandAmounts.some(value => value > 0);
				// ScaleはGaussianのsigmaを短辺の百分率で指定する。CoarseがFineより小さい場合は
				// 同じ半径まで戻し、中間帯域を0にする。描画解像度で帯域の大きさを変えない。
				const fineRadius = Math.max(0.0001, nonNegative(params.fineScale, 0.5) / 100);
				const coarseRadius = Math.max(fineRadius, nonNegative(params.coarseScale, 8) / 100);
				let captureGrid = [1, 1];
				let captureStep = [0, 0];
				if (active) {
					// 各ぼかしのsigmaをおよそ2作業画素に揃え、広い帯域でも一定の13タップで扱う。
					// 元画像の細部は最終段で直接参照するため、この作業解像度では制限されない。
					const fineSize = Math.max(2, Math.ceil(2 / fineRadius));
					const coarseSize = Math.min(fineSize, Math.max(2, Math.ceil(2 / coarseRadius)));
					if (resources == null || resources.fineSize !== fineSize || resources.coarseSize !== coarseSize) {
						const next = createResources(fineSize, coarseSize);
						resources?.dispose();
						resources = next;
					}
					const captureSize = resources.levels[0].texture;
					captureStep = [2 / captureSize.width, 2 / captureSize.height];
					if (params.input.kind === 'texture') {
						const scale = inputUvScale(params.input.texture, resolution, params.input.fitMode);
						captureGrid = [
							Math.min(16, Math.max(1, Math.ceil(params.input.texture.width * scale[0] / captureSize.width))),
							Math.min(16, Math.max(1, Math.ceil(params.input.texture.height * scale[1] / captureSize.height))),
						];
					}
				}
				seedValue[0] = params.seed;
				uniformValues.set({
					aspect,
					fineRadius,
					coarseRadius,
					probability,
					colorCorruption,
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					blockShape: params.blockShape.map((value, index) => Math.max(0.01, nonNegative(value, index === 0 ? 4 : 1))),
					fineShift,
					mediumShift,
					coarseShift,
					bandAmounts,
					captureGrid,
					captureStep,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const draw = (view: GPUTextureView, pipeline: GPURenderPipeline, group: GPUBindGroup, inputGroup: GPUBindGroup | null = null) => {
					const pass = ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [{
							view,
							clearValue: [0, 0, 0, 0],
							loadOp: 'clear',
							storeOp: 'store',
						}],
					});
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, group);
					if (inputGroup != null) pass.setBindGroup(1, inputGroup);
					pass.draw(6);
					pass.end();
				};
				if (active && resources != null) {
					// 入力のfitは内部の作業画像ではなく、実際の出力サイズを基準にする。
					const capture = capturePipelines.update({ input: params.input }, ctx.outputDataMap.output.texture);
					draw(resources.levels[0].view, capture.pipeline, captureGroup, capture.bindGroup);
					for (let index = 1; index < resources.levels.length; index++) {
						draw(resources.levels[index].view, downsample, resources.downGroups[index - 1]);
					}
					for (const [blur, radius] of [[resources.fine, fineRadius], [resources.coarse, coarseRadius]] as const) {
						for (const pass of blur.passes) {
							device.queue.writeBuffer(pass.stepBuffer, 0, new Float32Array([radius * pass.axis[0] / aspect[0], radius * pass.axis[1] / aspect[1], 0, 0]));
							draw(pass.view, gaussian, pass.group);
						}
					}
				}
				const composite = compositePipelines.update({ input: params.input }, ctx.outputDataMap.output.texture);
				draw(ctx.outputDataMap.output.textureView, composite.pipeline, resources?.compositeGroup ?? fallbackGroup, composite.bindGroup);
			},
			dispose: () => {
				resources?.dispose();
				capturePipelines.dispose();
				compositePipelines.dispose();
				uniformBuffer.destroy();
				zeroStepBuffer.destroy();
			},
		};
	},
});
