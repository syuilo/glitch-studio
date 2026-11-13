import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';
import { createSymbolTexture, getSymbolTextureUrls } from './textures.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, params, fallbackTexture, reportStatus }) => {
		const device = wgpu.device;
		const shaderDataDefinitions = makeShaderDataDefinitions(code);
		// 内部のシンボル配列と、接続から生成する入力のbindingを分離する。
		const symbolLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
			],
		});
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { input: 'color', forceField: 'vector' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [symbolLayout],
			// セルごとに異なる座標を読む。内部のシンボル配列は独自のsamplerでミップを選ぶ。
			sampling: 'level0',
		});

		const uniformValues = makeStructuredView(shaderDataDefinitions.uniforms.uniforms);

		const uniformBuffer = wgpu.device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const sampler = wgpu.device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			mipmapFilter: 'linear',
			addressModeU: 'mirror-repeat',
			addressModeV: 'mirror-repeat',
			addressModeW: 'mirror-repeat',
		});

		let symbolTexture: GPUTexture | null = null;

		let bindGroup: GPUBindGroup;
		const updateBindGroup = () => {
			bindGroup = device.createBindGroup({
				layout: symbolLayout,
				entries: [
					{ binding: 1, resource: { buffer: uniformBuffer } },
					{ binding: 2, resource: sampler },
					{ binding: 4, resource: (symbolTexture ?? fallbackTexture).createView({ dimension: '2d-array' }) },
				],
			});
		};
		updateBindGroup();

		let iconset = params.iconset;
		let symbolTextureCount = 0;
		let cacheVersion = 0;
		let loadVersion = 0;
		let disposed = false;
		const loadSymbolTextures = (type: string) => {
			reportStatus({ type: 'loading' });
			const version = ++loadVersion;
			const urls = getSymbolTextureUrls(type);
			void createSymbolTexture(wgpu.device, urls).then(texture => {
				// 遅れて完了した古い要求や、破棄済みインスタンスには結果を適用しない。
				if (disposed || version !== loadVersion) {
					texture.destroy();
					return;
				}
				symbolTexture?.destroy();
				symbolTexture = texture;
				symbolTextureCount = urls.length;
				updateBindGroup();
				cacheVersion++;
				reportStatus({ type: 'ready' });
			}).catch(error => {
				if (!disposed && version === loadVersion) {
					reportStatus({ type: 'error', message: error instanceof Error ? error.message : String(error) });
					console.error('Failed to load symbol textures:', error);
				}
			});
		};
		loadSymbolTextures(iconset);
		const prepare = (nextParams: typeof params) => {
			if (nextParams.iconset !== iconset) {
				iconset = nextParams.iconset;
				loadSymbolTextures(iconset);
			}
		};

		return {
			get cacheVersion() { return cacheVersion; },
			prepare,
			render: (ctx) => {
				prepare(ctx.params);
				const inputs = { input: ctx.params.input, forceField: ctx.params.forceField };
				const output = ctx.outputDataMap.output.texture;
				const variant = pipelines.update(inputs, output);

				const referenceLength = getSizeReferenceLength(ctx.params.sizeReference, output);
				uniformValues.set({
					coordinateScale: [output.width / referenceLength, output.height / referenceLength],
					displacementScale: spatialToNormalizedCoordinates([1, 1], output),
					vectorToPatternScale: 2 * Math.max(output.width, output.height) / referenceLength,
					highlightClipThreshold: ctx.params.highlightClipThreshold,
					shadowClipThreshold: ctx.params.shadowClipThreshold,
					density: Math.max(1, ctx.params.density),
					margin: ctx.params.margin,
					symbolTexturesCount: symbolTextureCount,
					symbolTexturesRangeMin: ctx.params.symbolTexturesRangeMin,
					symbolTexturesRangeMax: ctx.params.symbolTexturesRangeMax,
					useOriginalColor: ctx.params.iconset === 'sweets' ? 1 : 0,
					enableClippedAreaFill: ctx.params.iconset === 'sweets' ? 0 : 1,
					bgColor: ctx.params.bgColor,
					colorA: ctx.params.colorA,
					colorB: ctx.params.colorB,
					colorC: ctx.params.colorC,
					similarityThresholdFactor: ctx.params.similarityThresholdFactor,
					forceFieldShift: ctx.params.forceFieldShift ? 1 : 0,
					forceFieldWarp: ctx.params.forceFieldWarp ? 1 : 0,
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				passEncoder.setPipeline(variant.pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				passEncoder.draw(3);
				passEncoder.end();
			},
			dispose: () => {
				disposed = true;
				pipelines.dispose();
				uniformBuffer.destroy();
				symbolTexture?.destroy();
			},
		};
	},
});
