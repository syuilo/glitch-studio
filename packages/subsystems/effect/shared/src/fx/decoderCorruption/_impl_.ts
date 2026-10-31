import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs, inputUvScale } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createDecoderPartition, maximumPredictionBlockSamples, maximumSubdivisionLevels } from './partition.ts';
import commonCode from './common.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import decodeCode from './decode.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type definition from './_def_.ts';

const predictionModes = { automatic: 0, horizontal: 1, vertical: 2, dc: 3, planar: 4 };
const residualModes = { mixed: 0, drop: 1, invert: 2, amplify: 3 };
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
		const captureLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		});
		const decodeLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			],
		});
		const outputLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			],
		});
		const decode = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [decodeLayout] }),
			compute: { module: device.createShaderModule({ code: commonCode + '\n' + decodeCode }), entryPoint: 'decode' },
		});
		const createVariant = (input: ShaderInput) => {
			const generated = generateShaderInputs({ input: 'color' }, { input }, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const prefix = generated.code + '\n' + commonCode + '\n';
				return {
					capture: device.createComputePipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [captureLayout, bindings.layout] }),
						compute: { module: device.createShaderModule({ code: prefix + captureCode }), entryPoint: 'capture' },
					}),
					output: device.createRenderPipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
						vertex: { module: defaultVertexShaderModule },
						fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
						primitive: { topology: 'triangle-list' },
					}),
					bindings,
				};
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		};
		const variants = new Map<ShaderInput['kind'], ReturnType<typeof createVariant>>();
		const getVariant = (input: ShaderInput) => {
			let variant = variants.get(input.kind);
			if (variant == null) {
				variant = createVariant(input);
				variants.set(input.kind, variant);
			}
			return variant;
		};
		const getGeometry = (blockSize: number, referenceLength: number, packetWidth: number, packetHeight: number, subdivisions: number, originAtCenter: boolean) => {
			if (blockSize <= 0) throw new Error('Decoder corruption: maximum block size must be positive.');
			// 最大ブロックを仮想画像上の16サンプルへ対応付ける。論理寸法は丸めず、
			// 出力解像度や縦横比が変わっても正方形のブロックと同じ相対寸法を維持する。
			const scale = maximumPredictionBlockSamples * 100 / blockSize / referenceLength;
			const virtualSize = [resolution.width * scale, resolution.height * scale];
			const packetSize = [packetWidth * maximumPredictionBlockSamples, packetHeight * maximumPredictionBlockSamples];
			// 中央区画の中心を画像中央へ固定する。単にceilした個数で中央寄せすると、
			// 偶奇の切り替わりで半区画ずれるため、両側へ同数ずつ追加して常に奇数個にする。
			// 左上原点では従来どおり右端・下端だけを切り上げ、余白や走査順も維持する。
			const packetColumns = originAtCenter
				? 2 * Math.ceil(Math.max(0, virtualSize[0] / packetSize[0] - 1) / 2) + 1
				: Math.max(1, Math.ceil(virtualSize[0] / packetSize[0]));
			const packetRows = originAtCenter
				? 2 * Math.ceil(Math.max(0, virtualSize[1] / packetSize[1] - 1) / 2) + 1
				: Math.max(1, Math.ceil(virtualSize[1] / packetSize[1]));
			const width = packetColumns * packetSize[0];
			const height = packetRows * packetSize[1];
			const sampleCount = width * height;
			const originalByteLength = sampleCount * 16;
			const decodedByteLength = sampleCount * 32;
			// 細分化の上限を引き上げても、浅い設定で全段階分の記述領域を確保しない。
			// 指定された深さで全ブロックが分割された場合の容量だけを用意する。
			const minimumBlockSamples = maximumPredictionBlockSamples / 2 ** subdivisions;
			const descriptorByteLength = (packetColumns * packetRows + sampleCount / minimumBlockSamples ** 2) * 16;
			const maximumBufferLength = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
			if (![originalByteLength, decodedByteLength, descriptorByteLength].every(size => Number.isSafeInteger(size) && size > 0 && size <= maximumBufferLength)
				|| Math.ceil(width / 8) > device.limits.maxComputeWorkgroupsPerDimension
				|| Math.ceil(height / 8) > device.limits.maxComputeWorkgroupsPerDimension
				|| packetColumns > device.limits.maxComputeWorkgroupsPerDimension || packetRows > device.limits.maxComputeWorkgroupsPerDimension) {
				throw new Error('Decoder corruption: virtual image exceeds GPU resource limits. Increase Maximum block size.');
			}
			return {
				key: JSON.stringify([width, height, packetWidth, packetHeight, subdivisions, originAtCenter]),
				virtualSize,
				packetSize,
				packetColumns,
				packetRows,
				width,
				height,
				originalByteLength,
				decodedByteLength,
				descriptorByteLength,
			};
		};
		const createResources = (geometry: ReturnType<typeof getGeometry>) => {
			const buffers: GPUBuffer[] = [];
			const createBuffer = (size: number, usage: GPUBufferUsageFlags = GPUBufferUsage.STORAGE) => {
				const buffer = device.createBuffer({ size, usage });
				buffers.push(buffer);
				return buffer;
			};
			try {
				const original = createBuffer(geometry.originalByteLength);
				const decoded = createBuffer(geometry.decodedByteLength);
				const descriptors = createBuffer(geometry.descriptorByteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
				const originalEntry = { binding: 1, resource: { buffer: original } };
				const decodedEntry = { binding: 2, resource: { buffer: decoded } };
				return {
					geometryKey: geometry.key,
					descriptors,
					captureGroup: device.createBindGroup({ layout: captureLayout, entries: [uniformEntry, originalEntry] }),
					decodeGroup: device.createBindGroup({ layout: decodeLayout, entries: [uniformEntry, originalEntry, decodedEntry, { binding: 3, resource: { buffer: descriptors } }] }),
					outputGroup: device.createBindGroup({ layout: outputLayout, entries: [uniformEntry, originalEntry, decodedEntry] }),
					dispose: () => { for (const buffer of buffers) buffer.destroy(); },
				};
			} catch (error) {
				for (const buffer of buffers) buffer.destroy();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;
		let partitionKey: string | null = null;
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);
		return {
			render: ctx => {
				const params = ctx.params;
				if (Object.values(params).some(value => typeof value === 'number' && !Number.isFinite(value))) {
					throw new Error('Decoder corruption: numeric parameters must be finite.');
				}
				const packetWidth = clamp(Math.round(params.packetWidth), 1, 32);
				const packetHeight = clamp(Math.round(params.packetHeight), 1, 32);
				const subdivisions = clamp(Math.round(params.subdivisions), 0, maximumSubdivisionLevels);
				const originAtCenter = params.blockOrigin === 'center';
				const geometry = getGeometry(params.blockSize, getSizeReferenceLength(params.sizeReference, resolution), packetWidth, packetHeight, subdivisions, originAtCenter);
				if (resources == null || resources.geometryKey !== geometry.key) {
					const next = createResources(geometry);
					resources?.dispose();
					resources = next;
					partitionKey = null;
				}
				seedValue[0] = params.seed;
				const seed = (seedWords[0] ^ seedWords[1]) >>> 0;
				const corruptionProbability = clamp(params.corruptionProbability, 0, 1);
				const enabled = corruptionProbability > 0;
				if (enabled) {
					const splitProbability = clamp(params.splitProbability, 0, 1);
					const nextPartitionKey = JSON.stringify([geometry.key, splitProbability, seed]);
					if (partitionKey !== nextPartitionKey) {
						const descriptors = createDecoderPartition({
							packetColumns: geometry.packetColumns,
							packetRows: geometry.packetRows,
							packetWidth,
							packetHeight,
							originAtCenter,
							subdivisions,
							splitProbability,
							seed,
						});
						device.queue.writeBuffer(resources.descriptors, 0, descriptors);
						partitionKey = nextPartitionKey;
					}
				}
				let samplingGrid = [1, 1];
				if (params.input.kind === 'texture') {
					const scale = inputUvScale(params.input.texture, resolution, params.input.fitMode);
					samplingGrid = [
						clamp(Math.ceil(params.input.texture.width * scale[0] / geometry.virtualSize[0]), 1, 8),
						clamp(Math.ceil(params.input.texture.height * scale[1] / geometry.virtualSize[1]), 1, 8),
					];
				}
				uniformValues.set({
					virtualSize: geometry.virtualSize,
					gridSize: [geometry.width, geometry.height],
					packetSize: geometry.packetSize,
					samplingGrid,
					packetColumns: geometry.packetColumns,
					originAtCenter: Number(originAtCenter),
					predictionMode: predictionModes[params.predictionMode],
					corruptionProbability,
					burstLength: clamp(Math.round(params.burstLength), 1, 64),
					predictionError: clamp(params.predictionError, 0, 1),
					referenceShift: clamp(params.referenceShift, 0, 2),
					luminanceError: clamp(params.luminanceError, 0, 1),
					chromaError: clamp(params.chromaError, 0, 1),
					residualMode: residualModes[params.residualMode],
					residualError: clamp(params.residualError, 0, 1),
					residualNoise: clamp(params.residualNoise, 0, 1),
					propagation: clamp(params.propagation, 0, 1),
					recoveryProbability: clamp(params.recoveryProbability, 0, 1),
					preserveDetails: Number(params.preserveDetails),
					seed,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = getVariant(params.input);
				// 入力のfitは仮想画像ではなく実際の出力を基準にする。取得・出力で同じ参照設定を使う。
				const inputGroup = variant.bindings.update({ input: params.input }, ctx.outputDataMap.output.texture);
				if (enabled) {
					const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
					compute.setPipeline(variant.capture);
					compute.setBindGroup(0, resources.captureGroup);
					compute.setBindGroup(1, inputGroup);
					compute.dispatchWorkgroups(Math.ceil(geometry.width / 8), Math.ceil(geometry.height / 8));
					compute.setPipeline(decode);
					compute.setBindGroup(0, resources.decodeGroup);
					compute.dispatchWorkgroups(geometry.packetColumns, geometry.packetRows);
					compute.end();
				}
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
