import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { implementEffect } from '../../effect-implementation.ts';
import type { EffectOutputData } from '../../effect-implementation.ts';
import type definition from './_def_.ts';
import { packFlameTransforms, planFlameSampling, MAXIMUM_TRANSFORM_COUNT, FIXED_POINT_SCALE, MODEL_UNITS_PER_SPATIAL_UNIT } from './flame-settings.ts';
import commonCode from './common.wgsl?raw';
import accumulateCode from './accumulate.wgsl?raw';
import renderCode from './render.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
		density: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const transformBuffer = device.createBuffer({ size: MAXIMUM_TRANSFORM_COUNT * 16 * Float32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const uniformResource = { binding: 0, resource: { buffer: uniformBuffer } };
		const accumulateLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
		] });
		const renderLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		// Paletteは軌道上の各サンプルで評価するため、共通のRampをcomputeから使用する。
		const colorRamp = createColorRampBindings(device, 1, GPUShaderStage.COMPUTE);
		const accumulatePipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [accumulateLayout, colorRamp.layout] }),
			compute: { module: device.createShaderModule({ code: commonCode + '\n' + colorRamp.shaderCode + '\n' + accumulateCode }), entryPoint: 'accumulate' },
		});
		const renderModule = device.createShaderModule({ code: commonCode + '\n' + renderCode });
		const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderLayout] });
		const renderPipelines = new Map<number, GPURenderPipeline>();
		const spatialHalfExtent = getSpatialHalfExtent(resolution);

		function createHistogram(size: number) {
			// 1セルはcountと乗算済みRGBAの5つのu32。GPU上限を確保前に確認する。
			const byteLength = size * size * 5 * Uint32Array.BYTES_PER_ELEMENT;
			if (![256, 512, 1024, 2048].includes(size) || byteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)) {
				throw new Error('Fractal Flame exceeds GPU buffer limits or has an invalid Density Resolution. Reduce Density Resolution.');
			}
			const buffer = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			return {
				size, buffer,
				accumulateGroup: device.createBindGroup({ layout: accumulateLayout, entries: [uniformResource, { binding: 1, resource: { buffer } }, { binding: 2, resource: { buffer: transformBuffer } }] }),
				renderGroup: device.createBindGroup({ layout: renderLayout, entries: [uniformResource, { binding: 1, resource: { buffer } }] }),
			};
		}

		let histogram: ReturnType<typeof createHistogram> | null = null;
		let previousHistogramKey: string | null = null;
		return {
			render: ctx => {
				const outputs: (EffectOutputData | null)[] = (['output', 'density'] as const).map(port => ctx.usedOutputPorts == null || ctx.usedOutputPorts.has(port) ? ctx.outputDataMap[port] ?? null : null);
				const outputMask = (outputs[0] == null ? 0 : 1) | (outputs[1] == null ? 0 : 2);
				if (outputMask === 0) { return; }
				const params = ctx.params;
				const packed = packFlameTransforms(params.transforms);
				const sampling = planFlameSampling(params.orbitCount, params.iterations, params.burnIn, params.symmetry, params.mirror);
				const size = Number(params.densityResolution);
				if (![...params.position, params.scale, params.rotation, params.densityRadius, params.exposure, params.gamma, params.colorPhase, params.seed].every(value => Number.isFinite(Math.fround(value)))) {
					throw new Error('Fractal Flame requires finite position, scale, density radius, exposure, gamma, color phase and Seed representable as f32.');
				}
				if (params.densityRadius <= 0) throw new Error('Fractal Flame requires a positive Density Radius.');
				// 投影領域の面積・試行点数で正規化する。対称コピーやサンプル数だけを増やしても
				// 明るさを増やさず、領域外や発散で失った点を残りの点で埋め合わせない。
				const densityNormalization = size * size / (FIXED_POINT_SCALE * sampling.sampleCount * 4 * params.densityRadius ** 2);
				if (!Number.isFinite(Math.fround(densityNormalization)) || Math.fround(params.densityRadius) <= 0) throw new Error('Fractal Flame Density Radius exceeds GPU float32 range.');
				const rampGroup = colorRamp.update(params.ramp);
				if (histogram == null || histogram.size !== size) {
					const replacement = createHistogram(size);
					histogram?.buffer.destroy();
					histogram = replacement;
					previousHistogramKey = null;
				}
				const rotation = (params.rotation % 1) * 2 * Math.PI;
				const seed = Math.trunc(params.seed) >>> 0;
				const colorPhase = params.colorPhase - Math.floor(params.colorPhase);
				uniformValues.set({
					spatialHalfExtent, position: params.position, rotation: [Math.cos(rotation), Math.sin(rotation)],
					scale: Math.max(0.000001, params.scale), densityRadius: params.densityRadius,
					modelToSpatialScale: 1 / MODEL_UNITS_PER_SPATIAL_UNIT, densityNormalization,
					exposure: Math.max(0, params.exposure), inverseGamma: 1 / Math.max(0.01, params.gamma), colorPhase,
					fixedPointScale: FIXED_POINT_SCALE, maximumOutputDensity: wgpu.enable32bitDataTextures ? 3.4028234663852886e38 : 65504,
					seed, orbitCount: sampling.orbitCount, iterations: sampling.iterations, burnIn: sampling.burnIn,
					densitySize: size, transformCount: packed.count, symmetryOrder: sampling.symmetryOrder, mirror: Number(params.mirror),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const histogramKey = JSON.stringify([Array.from(packed.values), seed, sampling, params.mirror, size, params.densityRadius, params.ramp, colorPhase]);
				if (histogramKey !== previousHistogramKey) {
					device.queue.writeBuffer(transformBuffer, 0, packed.values);
					ctx.commandEncoder.clearBuffer(histogram.buffer);
					const pass = ctx.createComputePassEncoder(ctx.commandEncoder);
					pass.setPipeline(accumulatePipeline);
					pass.setBindGroup(0, histogram.accumulateGroup);
					pass.setBindGroup(1, rampGroup);
					pass.dispatchWorkgroups(Math.ceil(sampling.orbitCount / 64));
					pass.end();
					previousHistogramKey = histogramKey;
				}
				let pipeline = renderPipelines.get(outputMask);
				if (pipeline == null) {
					pipeline = device.createRenderPipeline({ layout: renderPipelineLayout, vertex: { module: wgpu.defaultVertexShaderModule }, fragment: {
						module: renderModule, entryPoint: 'fs', constants: { RENDER_COLOR: outputs[0] != null ? 1 : 0 },
						targets: outputs.map(output => output == null ? null : { format: output.texture.format }),
					} });
					renderPipelines.set(outputMask, pipeline);
				}
				const pass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: outputs.map(output => output == null ? null : {
					view: output.textureView, clearValue: [0, 0, 0, 0], loadOp: 'clear' as const, storeOp: 'store' as const,
				}) });
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, histogram.renderGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				histogram?.buffer.destroy();
				transformBuffer.destroy();
				uniformBuffer.destroy();
				colorRamp.dispose();
			},
		};
	},
});
