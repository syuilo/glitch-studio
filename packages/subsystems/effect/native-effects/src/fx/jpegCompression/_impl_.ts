import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { inputUvScale } from '@gs/shared/gpu/shader-input.ts';
import { createFixedInputBindings } from '../../shader-input.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import commonCode, { uniforms as commonCodeUniforms } from './common.shader.ts?shader';
import compressCode from './compress.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const inputSchema = { input: 'color', quality: 'scalar' } as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, defaultVertexShaderModule, resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const compressLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		});
		const outputLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			],
		});

		function createPipelines() {
			// 入力画像とQualityはそれぞれ定数・テクスチャを受け取る。computeとfragmentで
			// 同じbindingを使い、接続ごとのfit/wrap/filterも共通の入力基盤へ任せる。
			const bindings = createFixedInputBindings(device, inputSchema, params, context.resolution, 1, 'level0');
			try {
				const prefix = bindings.code + '\n' + commonCode + '\n';
				const compress = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [compressLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: prefix + compressCode }), entryPoint: 'compress' },
				});
				const output = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
					primitive: { topology: 'triangle-list' },
				});
				return { compress, output, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}

		// 入力画像とQualityの種別だけで最大4構成。値・接続先・samplingの変更では再生成しない。
		const pipelines = createPipelines();

		const getGeometry = (blockSize: number, referenceLength: number, subsample: boolean, originAtCenter: boolean) => {
			if (!Number.isFinite(blockSize) || blockSize <= 0) throw new Error('JPEG compression: block size must be a positive finite number.');
			// 輝度ブロックの一辺を基準寸法の百分率で指定し、出力解像度と切り離す。
			// 仮想画像を整数寸法へ丸めず、縦横のサンプル間隔を同じに保つ。
			const scale = (8 * 100 / blockSize) / referenceLength;
			const virtualSize = [resolution.width * scale, resolution.height * scale];
			const mcuSize = subsample ? 16 : 8;
			// 中央原点は奇数個のMCUで覆い、個数が変わっても格子が半MCUずれることを防ぐ。
			// 左上原点は端の不足部分だけを切り上げる。
			const mcuColumns = originAtCenter
				? 2 * Math.ceil(Math.max(0, virtualSize[0] / mcuSize - 1) / 2) + 1
				: Math.max(1, Math.ceil(virtualSize[0] / mcuSize));
			const mcuRows = originAtCenter
				? 2 * Math.ceil(Math.max(0, virtualSize[1] / mcuSize - 1) / 2) + 1
				: Math.max(1, Math.ceil(virtualSize[1] / mcuSize));
			const gridSize = [mcuColumns * mcuSize, mcuRows * mcuSize];
			const blocksPerMcu = subsample ? 6 : 3;
			const sampleBytes = mcuColumns * mcuRows * blocksPerMcu * 64 * 4;
			const maxBufferSize = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
			if (!Number.isSafeInteger(sampleBytes) || sampleBytes > maxBufferSize
				|| mcuColumns > device.limits.maxComputeWorkgroupsPerDimension || mcuRows > device.limits.maxComputeWorkgroupsPerDimension) {
				// 見た目を維持するため、リソース不足でも仮想解像度を勝手に変更しない。
				throw new Error('JPEG compression: virtual image exceeds GPU resource limits. Increase Block Size.');
			}
			return {
				virtualSize,
				gridSize,
				mcuColumns,
				mcuRows,
				blocksPerMcu,
				sampleBytes,
			};
		};
		const createResources = (geometry: ReturnType<typeof getGeometry>, preserveDetails: boolean) => {
			const buffers: GPUBuffer[] = [];
			const createBuffer = (size: number) => {
				const buffer = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE });
				buffers.push(buffer);
				return buffer;
			};
			try {
				// DCT係数はworkgroup内のf32で完結する。ここでは復元済み成分と比較用成分だけを保持する。
				// 色差は符号付きなので、通常の画像用中間テクスチャの値域へ丸めない。
				const decoded = createBuffer(geometry.sampleBytes);
				// 細部保持が無効の場合はbindingに必要な1要素だけ確保する。
				const referenceSamples = createBuffer(preserveDetails ? geometry.sampleBytes : 4);
				const entries = [uniformEntry,
																					{ binding: 1, resource: { buffer: decoded } },
																					{ binding: 2, resource: { buffer: referenceSamples } },
				];
				return {
					mcuColumns: geometry.mcuColumns,
					mcuRows: geometry.mcuRows,
					blocksPerMcu: geometry.blocksPerMcu,
					preserveDetails,
					compressGroup: device.createBindGroup({ layout: compressLayout, entries }),
					outputGroup: device.createBindGroup({ layout: outputLayout, entries }),
					dispose: () => { for (const buffer of buffers) buffer.destroy(); },
				};
			} catch (error) {
				for (const buffer of buffers) buffer.destroy();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;

		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const subsample = params.chromaSubsampling === '420';
				const originAtCenter = params.blockOrigin === 'center';
				const geometry = getGeometry(params.blockSize, getSizeReferenceLength(params.sizeReference, resolution), subsample, originAtCenter);
				if (resources == null || resources.mcuColumns !== geometry.mcuColumns || resources.mcuRows !== geometry.mcuRows
					|| resources.blocksPerMcu !== geometry.blocksPerMcu || resources.preserveDetails !== params.preserveDetails) {
					const next = createResources(geometry, params.preserveDetails);
					resources?.dispose();
					resources = next;
				}
				let samplingGrid = [1, 1];
				if (params.input.kind === 'texture') {
					const scale = inputUvScale(params.input.resolution, resolution, params.input.fitMode);
					samplingGrid = [
						clamp(Math.ceil(params.input.resolution.width * scale[0] / geometry.virtualSize[0]), 1, 16),
						clamp(Math.ceil(params.input.resolution.height * scale[1] / geometry.virtualSize[1]), 1, 16),
					];
				}
				uniformValues.set({
					virtualSize: geometry.virtualSize,
					gridSize: geometry.gridSize,
					samplingGrid,
					mcuColumns: geometry.mcuColumns,
					blocksPerMcu: geometry.blocksPerMcu,
					subsample: Number(subsample),
					originAtCenter: Number(originAtCenter),
					preserveDetails: Number(params.preserveDetails),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 仮想寸法ではなく最終出力寸法をfitの基準にし、両入力の空間的な対応を保つ。
				const inputGroup = pipelines.bindings.getBindGroup();
				const compute = commandEncoder.beginComputePass();
				compute.setPipeline(pipelines.compress);
				compute.setBindGroup(0, resources.compressGroup);
				compute.setBindGroup(1, inputGroup);
				compute.dispatchWorkgroups(geometry.mcuColumns, geometry.mcuRows, geometry.blocksPerMcu);
				compute.end();
				const output = beginOutputPass(commandEncoder, outputView);
				output.setPipeline(pipelines.output);
				output.setBindGroup(0, resources.outputGroup);
				output.setBindGroup(1, inputGroup);
				output.draw(3);
				output.end();
			},
			dispose: () => {
				resources?.dispose();
				pipelines.bindings.dispose();
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
