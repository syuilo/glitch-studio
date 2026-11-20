import { prepareSymbolMipmaps } from './texture-array.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createFixedInputPipeline, bindParameterValues, beginOutputPass } from '../../multipass.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import { createSymbolTexture, getSymbolTextureUrls } from './textures.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		// 内部のシンボル配列と、接続から生成する入力のbindingを分離する。
		const symbolLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
			],
		});
		const pipelines = createFixedInputPipeline(params, resolution, {
			device,
			vertex: defaultVertexShaderModule,
			code,
			schema: { input: 'color', forceField: 'vector' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [symbolLayout],
			// セルごとに異なる座標を読む。内部のシンボル配列は独自のsamplerでミップを選ぶ。
			sampling: 'level0',
		});

		const uniformValues = createShaderBuffer(codeUniforms.uniforms);

		const uniformBuffer = device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const sampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			mipmapFilter: 'linear',
			addressModeU: 'mirror-repeat',
			addressModeV: 'mirror-repeat',
			addressModeW: 'mirror-repeat',
		});

		let symbolTexture: GPUTexture | null = null;

		prepareSymbolMipmaps(device);
		let bindGroup: GPUBindGroup;
		let loadedIconset: typeof params.iconset | null = null;
		let symbolTextureCount = 0;

		type TextureRequest = { iconset: typeof params.iconset; signal: AbortSignal };
		let pending: { request: TextureRequest; task: Promise<void> } | null = null;

		async function load(request: TextureRequest) {
			const { iconset } = request;
			const urls = getSymbolTextureUrls(iconset);
			const texture = await createSymbolTexture(device, urls);
			try {
				// 別のアイコンセットへの切り替えや配置の破棄で中断した要求は、完了しても結果を適用しない。
				request.signal.throwIfAborted();
				bindGroup = device.createBindGroup({ layout: symbolLayout, entries: [
					{ binding: 1, resource: { buffer: uniformBuffer } }, { binding: 2, resource: sampler },
					{ binding: 4, resource: texture.createView({ dimension: '2d-array' }) },
				] });
			} catch (error) {
				texture.destroy();
				throw error;
			}
			symbolTexture?.destroy();
			symbolTexture = texture;
			loadedIconset = iconset;
			symbolTextureCount = urls.length;
		}

		return {
			cacheKey: 0,
			prepare(_frame, signal) {
				const iconset = params.iconset;
				if (iconset === loadedIconset) return;
				// 同じアイコンセットを待つ連続フレームでPNGのデコードとmipmap生成を共有する。
				if (pending?.request.iconset === iconset) {
					pending.request.signal = signal;
					return pending.task;
				}
				const request = { iconset, signal };
				const task = load(request).finally(() => { if (pending?.request === request) pending = null; });
				pending = { request, task };
				return task;
			},
			render(ctx) {
				const output = outputTexture;
				const referenceLength = getSizeReferenceLength(params.sizeReference, output);
				uniformValues.set({
					coordinateScale: [output.width / referenceLength, output.height / referenceLength],
					displacementScale: spatialToNormalizedCoordinates([1, 1], output),
					vectorToPatternScale: 2 * Math.max(output.width, output.height) / referenceLength,
					highlightClipThreshold: params.highlightClipThreshold,
					shadowClipThreshold: params.shadowClipThreshold,
					density: Math.max(1, params.density),
					margin: params.margin,
					symbolTexturesCount: symbolTextureCount,
					symbolTexturesRangeMin: params.symbolTexturesRangeMin,
					symbolTexturesRangeMax: params.symbolTexturesRangeMax,
					useOriginalColor: params.iconset === 'sweets' ? 1 : 0,
					enableClippedAreaFill: params.iconset === 'sweets' ? 0 : 1,
					bgColor: params.bgColor,
					colorA: params.colorA,
					colorB: params.colorB,
					colorC: params.colorC,
					similarityThresholdFactor: params.similarityThresholdFactor,
					forceFieldShift: params.forceFieldShift ? 1 : 0,
					forceFieldWarp: params.forceFieldWarp ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = beginOutputPass(ctx.commandEncoder, outputView);
				passEncoder.setPipeline(pipelines.pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.setBindGroup(pipelines.inputGroup, pipelines.getBindGroup());
				passEncoder.draw(3);
				passEncoder.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
				symbolTexture?.destroy();
			},
		};
	},
};

export default implementation;
