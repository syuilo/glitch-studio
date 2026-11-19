import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
// Adapted from Paper Design's Liquid Metal (Apache-2.0; see LICENSE).
// Modified for WebGPU and live node inputs; no uploaded-image or shape selector.
import { createFixedInputBindings } from '../../shader-input.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import preprocessCode from './preprocess.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const { device } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const sampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});
		const gradientFormat = context.enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const computeLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: gradientFormat } },
			],
		});
		const renderLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			],
		});

		function createPipelines() {
			const bindings = createFixedInputBindings(device, { input: 'color' }, params, context.resolution, 1, 'level0');
			try {
				// 形状判定と最終アルファで同じfit/wrap/filterを使い、輪郭と切り抜き位置を一致させる。
				const computeModule = device.createShaderModule({ code: bindings.code + '\n' + preprocessCode.replace('rgba16float', gradientFormat) });
				const initialize = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, bindings.layout] }),
					compute: { module: computeModule, entryPoint: 'initialize' },
				});
				const pipeline = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout, bindings.layout] }),
					vertex: { module: context.defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: bindings.code + '\n' + code }), targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
					primitive: { topology: 'triangle-list' },
				});
				return {
					computeModule,
					initialize,
					pipeline,
					bindings,
				};
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}

		// uniform/textureの2構成だけ保持し、接続設定や値の変更ではpipelineを再生成しない。
		const pipelines = createPipelines();
		// 反復計算と正規化は外部入力を読まないため、入力種別によらず共有する。
		const computeModule = pipelines.computeModule;
		const layout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
		const makeCompute = (entryPoint: string, constants?: Record<string, number>) => device.createComputePipeline({ layout, compute: { module: computeModule, entryPoint, constants } });
		const red = makeCompute('solve', { parity: 0 });
		const black = makeCompute('solve', { parity: 1 });
		const findMaximum = makeCompute('findMaximum');
		const finish = makeCompute('finish');
		const maximum = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		// fit/wrap後の表示形状を解くため、入力サイズではなく出力比率に合わせる。
		// 作業領域は原則短辺512pxとし、入力がuniformでも同じ座標系を使う。
		const scale = Math.min(512 / Math.min(resolution.width, resolution.height), device.limits.maxTextureDimension2D / Math.max(resolution.width, resolution.height));
		const width = Math.max(1, Math.round(resolution.width * scale));
		const height = Math.max(1, Math.round(resolution.height * scale));
		const gradient = device.createTexture({ size: [width, height], format: gradientFormat, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
		const pixels = device.createBuffer({ size: width * height * 8, usage: GPUBufferUsage.STORAGE });
		const computeGroup = device.createBindGroup({
			layout: computeLayout,
			entries: [
				{ binding: 2, resource: { buffer: pixels } },
				{ binding: 3, resource: { buffer: maximum } },
				{ binding: 4, resource: gradient.createView() },
			],
		});
		// 内部の輪郭データには入力接続のwrap/filterを適用せず、linear/clampで補間する。
		const renderGroup = device.createBindGroup({
			layout: renderLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: sampler },
				{ binding: 3, resource: gradient.createView() },
			],
		});
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const p = params;
				// 作業サイズの丸めでfitが変わらないよう、両passの入力を最終出力サイズで更新する。
				const inputGroup = pipelines.bindings.getBindGroup();
				uniformValues.set({
					...p,
					resolution: [resolution.width, resolution.height],
					// Upstream frame is milliseconds. Explicit time makes seeking deterministic.
					time: p.time * p.speed + p.frame / 1000,
					repetition: Math.max(1, p.repetition),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				commandEncoder.clearBuffer(maximum);
				// Rebuild every frame: animated nodes can change without changing textures.
				// No history or CPU readback; seeking always reproduces the same gradient.
				const compute = commandEncoder.beginComputePass();
				compute.setBindGroup(0, computeGroup);
				compute.setBindGroup(1, inputGroup);
				const dispatch = (step: GPUComputePipeline) => {
					compute.setPipeline(step);
					compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
				};
				dispatch(pipelines.initialize);
				// SOR converges ~2-20x faster than standard Gauss-Seidel.
				for (let i = 0; i < 40; i++) {
					dispatch(red);
					dispatch(black);
				}
				dispatch(findMaximum);
				dispatch(finish);
				compute.end();
				const pass = beginOutputPass(commandEncoder, outputView);
				pass.setPipeline(pipelines.pipeline);
				pass.setBindGroup(0, renderGroup);
				pass.setBindGroup(1, inputGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				pipelines.bindings.dispose();
				uniformBuffer.destroy();
				maximum.destroy();
				pixels.destroy();
				gradient.destroy();
			},
		};
	},
};

export default implementation;
