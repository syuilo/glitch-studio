import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { MAXIMUM_ORBIT_COUNT, MAXIMUM_ITERATIONS, MAXIMUM_BURN_IN } from './_def_.ts';
import commonCode from './common.wgsl?raw';
import accumulateCode from './accumulate.wgsl?raw';
import renderCode from './render.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		density: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution, params }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformResource = { binding: 0, resource: { buffer: uniformBuffer } };
		const accumulateLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const renderLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const accumulatePipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [accumulateLayout] }),
			compute: { module: device.createShaderModule({ code: commonCode + '\n' + accumulateCode }), entryPoint: 'accumulate' },
		});
		const colorRamp = createColorRampBindings(device, 1);
		const renderModule = device.createShaderModule({ code: commonCode + '\n' + colorRamp.shaderCode + '\n' + renderCode });
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderLayout, colorRamp.layout] });
		const createRenderPipeline = (entryPoint: string, targets: GPUColorTargetState[]) => device.createRenderPipeline({
			layout: pipelineLayout,
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: renderModule, entryPoint, targets },
			primitive: { topology: 'triangle-list' },
		});
		const colorPipeline = createRenderPipeline('colorFragment', [{ format: wgpu.intermediateTextureFormat }]);
		const colorAndDensityPipeline = createRenderPipeline('colorAndDensityFragment', [
			{ format: wgpu.intermediateTextureFormat },
			{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' },
		]);

		function createHistogramResources(size: number) {
			const byteLength = size * size * Uint32Array.BYTES_PER_ELEMENT;
			if (!Number.isSafeInteger(byteLength) || byteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)) {
				throw new Error('Clifford / De Jong Attractor exceeds GPU buffer limits. Reduce Density Resolution.');
			}
			const buffer = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			const entries = [uniformResource, { binding: 1, resource: { buffer } }];
			return {
				size,
				buffer,
				accumulateGroup: device.createBindGroup({ layout: accumulateLayout, entries }),
				renderGroup: device.createBindGroup({ layout: renderLayout, entries }),
			};
		}

		let histogram = createHistogramResources(Number(params.densityResolution));
		let previousHistogramKey: string | null = null;
		return {
			render: ctx => {
				const size = Number(ctx.params.densityResolution);
				if (histogram.size !== size) {
					const replacement = createHistogramResources(size);
					histogram.buffer.destroy();
					histogram = replacement;
					previousHistogramKey = null;
				}
				const coefficients = [ctx.params.a, ctx.params.b, ctx.params.c, ctx.params.d];
				const orbitCount = Math.min(MAXIMUM_ORBIT_COUNT, Math.max(1, Math.floor(ctx.params.orbitCount)));
				const iterations = Math.min(MAXIMUM_ITERATIONS, Math.max(1, Math.floor(ctx.params.iterations)));
				const burnIn = Math.min(MAXIMUM_BURN_IN, Math.max(0, Math.floor(ctx.params.burnIn)));
				if (![...coefficients, orbitCount, iterations, burnIn, ctx.params.seed].every(Number.isFinite)) {
					throw new Error('Clifford / De Jong Attractor requires finite coefficients, sample counts and Seed.');
				}
				const formula = ctx.params.formula === 'clifford' ? 0 : 1;
				const seed = Math.trunc(ctx.params.seed) >>> 0;
				// Cliffordでは|x|<=1+|c|、|y|<=1+|d|。De Jongでは両軸とも|p|<=2。
				// 外周に1セルずつ余白を置き、端の点を隣接4セルへ分配しても密度を欠落させない。
				const domainHalfExtent = (formula === 0 ? [1 + Math.abs(ctx.params.c), 1 + Math.abs(ctx.params.d)] : [2, 2])
					.map(value => value * size / (size - 2));
				const sampleCount = orbitCount * iterations;
				uniformValues.set({
					coefficients,
					domainHalfExtent,
					spatialHalfExtent: getSpatialHalfExtent(resolution),
					position: ctx.params.position,
					scale: Math.max(0.000001, ctx.params.scale),
					rotation: (ctx.params.rotation % 1) * 2 * Math.PI,
					exposure: Math.max(0, ctx.params.exposure),
					inverseGamma: 1 / Math.max(0.01, ctx.params.gamma),
					// 固定小数点の倍率256と、セルのモデル座標面積、総点数で割って確率密度にする。
					// サンプル数や格子解像度を増やしただけで、全体の明るさが増えないようにする。
					densityNormalization: size * size / (256 * sampleCount * 4 * domainHalfExtent[0] * domainHalfExtent[1]),
					densitySize: size,
					formula,
					seed,
					orbitCount,
					iterations,
					burnIn,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const histogramKey = JSON.stringify([formula, coefficients, seed, orbitCount, iterations, burnIn, size]);
				if (histogramKey !== previousHistogramKey) {
					// 履歴の蓄積ではなく、現在の設定だけから再生成できる描画キャッシュ。
					// 配置・配色・露光量だけの編集では、重い軌道の生成と集計を繰り返さない。
					ctx.commandEncoder.clearBuffer(histogram.buffer);
					const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
					compute.setPipeline(accumulatePipeline);
					compute.setBindGroup(0, histogram.accumulateGroup);
					compute.dispatchWorkgroups(Math.ceil(orbitCount / 64));
					compute.end();
					previousHistogramKey = histogramKey;
				}
				const rampGroup = colorRamp.update(ctx.params.ramp);
				const densityOutput = ctx.outputDataMap.density;
				const pass = densityOutput == null
					? ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView)
					: ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [ctx.outputDataMap.output, densityOutput].map(output => ({
							view: output.textureView, clearValue: [0, 0, 0, 0], loadOp: 'clear' as const, storeOp: 'store' as const,
						})),
					});
				pass.setPipeline(densityOutput == null ? colorPipeline : colorAndDensityPipeline);
				pass.setBindGroup(0, histogram.renderGroup);
				pass.setBindGroup(1, rampGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				colorRamp.dispose();
				uniformBuffer.destroy();
				histogram.buffer.destroy();
			},
		};
	},
});
