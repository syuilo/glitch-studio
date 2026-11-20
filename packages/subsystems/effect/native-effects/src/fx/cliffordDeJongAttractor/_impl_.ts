import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { bindParameterValues } from '../../multipass.ts';
import { MAXIMUM_ORBIT_COUNT, MAXIMUM_ITERATIONS, MAXIMUM_BURN_IN } from './_def_.ts';
import commonCode, { uniforms as commonCodeUniforms } from './common.wgsl?shader';
import accumulateCode from './accumulate.wgsl?raw';
import renderCode from './render.wgsl?raw';
import colorCode from './color.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, 'ramp'> = {
	init(context) {
		const { resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputs = ['output', 'density'].map(port => outputTextures.get(port));
		const outputPass: GPURenderPassDescriptor = { colorAttachments: outputs.map(texture => texture == null ? null : {
			view: texture.createView(), loadOp: 'clear', storeOp: 'store',
		}) };
		const device = context.device;
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
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
		const colorRamp = outputs[0] == null ? null : createColorRampBindings(device, 1);
		const renderModule = device.createShaderModule({ code: [commonCode, renderCode, colorRamp?.shaderCode, colorRamp == null ? '' : colorCode].join('\n') });
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: colorRamp == null ? [renderLayout] : [renderLayout, colorRamp.layout] });
		const pipeline = device.createRenderPipeline({
			layout: pipelineLayout, vertex: { module: context.defaultVertexShaderModule },
			fragment: { module: renderModule, entryPoint: colorRamp == null ? 'densityFragment' : outputs[1] == null ? 'colorFragment' : 'colorAndDensityFragment',
															targets: outputs.map(texture => texture == null ? null : { format: texture.format }) },
		});

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
			cacheKey: 0,
			invalidateRenderCache() {
				previousHistogramKey = null;
			},
			render({ commandEncoder }) {
				const size = Number(params.densityResolution);
				if (histogram.size !== size) {
					const replacement = createHistogramResources(size);
					histogram.buffer.destroy();
					histogram = replacement;
					previousHistogramKey = null;
				}
				const coefficients = [params.a, params.b, params.c, params.d];
				const orbitCount = Math.min(MAXIMUM_ORBIT_COUNT, Math.max(1, Math.floor(params.orbitCount)));
				const iterations = Math.min(MAXIMUM_ITERATIONS, Math.max(1, Math.floor(params.iterations)));
				const burnIn = Math.min(MAXIMUM_BURN_IN, Math.max(0, Math.floor(params.burnIn)));
				if (![...coefficients, orbitCount, iterations, burnIn, params.seed].every(Number.isFinite)) {
					throw new Error('Clifford / De Jong Attractor requires finite coefficients, sample counts and Seed.');
				}
				const formula = params.formula === 'clifford' ? 0 : 1;
				const seed = Math.trunc(params.seed) >>> 0;
				// Cliffordでは|x|<=1+|c|、|y|<=1+|d|。De Jongでは両軸とも|p|<=2。
				// 外周に1セルずつ余白を置き、端の点を隣接4セルへ分配しても密度を欠落させない。
				const domainHalfExtent = (formula === 0 ? [1 + Math.abs(params.c), 1 + Math.abs(params.d)] : [2, 2])
					.map(value => value * size / (size - 2));
				const sampleCount = orbitCount * iterations;
				uniformValues.set({
					coefficients,
					domainHalfExtent,
					spatialHalfExtent: getSpatialHalfExtent(resolution),
					position: params.position,
					scale: Math.max(0.000001, params.scale),
					rotation: (params.rotation % 1) * 2 * Math.PI,
					exposure: Math.max(0, params.exposure),
					inverseGamma: 1 / Math.max(0.01, params.gamma),
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
					commandEncoder.clearBuffer(histogram.buffer);
					const compute = commandEncoder.beginComputePass();
					compute.setPipeline(accumulatePipeline);
					compute.setBindGroup(0, histogram.accumulateGroup);
					compute.dispatchWorkgroups(Math.ceil(orbitCount / 64));
					compute.end();
					previousHistogramKey = histogramKey;
				}
				const pass = commandEncoder.beginRenderPass(outputPass);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, histogram.renderGroup);
				if (colorRamp != null) pass.setBindGroup(1, colorRamp.update(params.ramp!));
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				colorRamp?.dispose();
				uniformBuffer.destroy();
				histogram.buffer.destroy();
			},
		};
	},
};

export default implementation;
