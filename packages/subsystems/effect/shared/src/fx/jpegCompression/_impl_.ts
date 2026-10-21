import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs, inputUvScale, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputValues } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import compressCode from './compress.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type definition from './_def_.ts';

const inputSchema = { input: 'color', quality: 'scalar' } as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution }) => {
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
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

		const createVariant = (inputs: ShaderInputValues<typeof inputSchema>) => {
			// 入力画像とQualityはそれぞれ定数・テクスチャを受け取る。computeとfragmentで
			// 同じbindingを使い、接続ごとのfit/wrap/filterも共通の入力基盤へ任せる。
			const generated = generateShaderInputs(inputSchema, inputs, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const prefix = generated.code + '\n' + commonCode + '\n';
				const compress = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [compressLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: prefix + compressCode }), entryPoint: 'compress' },
				});
				const output = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
					primitive: { topology: 'triangle-list' },
				});
				return { compress, output, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		};
		// 入力画像とQualityの種別だけで最大4構成。値・接続先・samplingの変更では再生成しない。
		const variants = new Map<string, ReturnType<typeof createVariant>>();
		const getVariant = (inputs: ShaderInputValues<typeof inputSchema>) => {
			const key = shaderInputVariantKey(inputSchema, inputs);
			let variant = variants.get(key);
			if (variant == null) {
				variant = createVariant(inputs);
				variants.set(key, variant);
			}
			return variant;
		};

		const getGeometry = (blockSize: number, subsample: boolean, originAtCenter: boolean) => {
			if (!Number.isFinite(blockSize) || blockSize <= 0) throw new Error('JPEG compression: block size must be a positive finite number.');
			// 輝度ブロックの一辺を画面短辺の百分率で指定し、出力解像度と切り離す。
			// 仮想画像を整数寸法へ丸めず、縦横のサンプル間隔を同じに保つ。
			const shortSide = Math.min(resolution.width, resolution.height);
			const scale = (8 * 100 / blockSize) / shortSide;
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
			render: ctx => {
				const params = ctx.params;
				const subsample = params.chromaSubsampling === '420';
				const originAtCenter = params.blockOrigin === 'center';
				const geometry = getGeometry(params.blockSize, subsample, originAtCenter);
				if (resources == null || resources.mcuColumns !== geometry.mcuColumns || resources.mcuRows !== geometry.mcuRows
					|| resources.blocksPerMcu !== geometry.blocksPerMcu || resources.preserveDetails !== params.preserveDetails) {
					const next = createResources(geometry, params.preserveDetails);
					resources?.dispose();
					resources = next;
				}
				let samplingGrid = [1, 1];
				if (params.input.kind === 'texture') {
					const scale = inputUvScale(params.input.texture, resolution, params.input.fitMode);
					samplingGrid = [
						clamp(Math.ceil(params.input.texture.width * scale[0] / geometry.virtualSize[0]), 1, 16),
						clamp(Math.ceil(params.input.texture.height * scale[1] / geometry.virtualSize[1]), 1, 16),
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
				const inputs = { input: params.input, quality: params.quality };
				const variant = getVariant(inputs);
				// 仮想寸法ではなく最終出力寸法をfitの基準にし、両入力の空間的な対応を保つ。
				const inputGroup = variant.bindings.update(inputs, ctx.outputDataMap.output.texture);
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				compute.setPipeline(variant.compress);
				compute.setBindGroup(0, resources.compressGroup);
				compute.setBindGroup(1, inputGroup);
				compute.dispatchWorkgroups(geometry.mcuColumns, geometry.mcuRows, geometry.blocksPerMcu);
				compute.end();
				const output = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				output.setPipeline(variant.output);
				output.setBindGroup(0, resources.outputGroup);
				output.setBindGroup(1, inputGroup);
				output.draw(6);
				output.end();
			},
			dispose: () => {
				resources?.dispose();
				for (const variant of variants.values()) variant.bindings.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
