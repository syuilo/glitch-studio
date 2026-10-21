import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs, inputUvScale } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import encodeCode from './encode.wgsl?raw';
import scanCode from './scan.wgsl?raw';
import decodeCode from './decode.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type definition from './_def_.ts';

const acModes = {
	mixed: 0,
	drop: 1,
	invert: 2,
	amplify: 3,
	shift: 4,
};
const inverseTransforms = { dct: 0, hadamard: 1 };
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
		const encodeLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		});
		const scanLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		});
		const decodeLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
				{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		});
		const outputLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
				{ binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			],
		});
		const scan = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [scanLayout] }),
			compute: { module: device.createShaderModule({ code: commonCode + '\n' + scanCode }), entryPoint: 'scan' },
		});
		const decode = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [decodeLayout] }),
			compute: { module: device.createShaderModule({ code: commonCode + '\n' + decodeCode }), entryPoint: 'decode' },
		});

		// computeでの入力取得とfragmentでのalpha取得は同じ生成関数を使い、
		// 定数・テクスチャの両方で入力接続のfit/wrap/filterを一貫して適用する。
		const createVariant = (input: ShaderInput) => {
			const generated = generateShaderInputs({ input: 'color' }, { input }, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const prefix = generated.code + '\n' + commonCode + '\n';
				const encode = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [encodeLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: prefix + encodeCode }), entryPoint: 'encode' },
				});
				const output = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
					primitive: { topology: 'triangle-list' },
				});
				return { encode, output, bindings };
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

		const getGeometry = (blockSize: number, subsample: boolean, originAtCenter: boolean) => {
			if (!Number.isFinite(blockSize) || blockSize <= 0) throw new Error('JPEG glitch: block size must be a positive finite number.');
			// Block sizeは輝度ブロックの一辺を画面短辺に対する百分率で指定する。
			// 仮想寸法を整数に丸めないことで、解像度の変更によるブロックの伸縮と縦横の歪みを避ける。
			const shortSide = Math.min(resolution.width, resolution.height);
			const scale = (8 * 100 / blockSize) / shortSide;
			const virtualSize = [resolution.width * scale, resolution.height * scale];
			const mcuSize = subsample ? 16 : 8;
			// 中央MCUの中心を画像中央へ固定し、画像を覆うまで両側にMCUを追加する。
			// 単純にceilした個数で中央寄せすると、偶数・奇数の切り替わりで格子が半MCUずれる。
			// 常に奇数個なら、個数が変わっても同じ格子を整数MCUずつ外側へ広げるだけになる。
			// 左上原点では元の格子と走査順を再現するため、右端・下端の不足分だけ切り上げる。
			const mcuColumns = originAtCenter
				? 2 * Math.ceil(Math.max(0, virtualSize[0] / mcuSize - 1) / 2) + 1
				: Math.max(1, Math.ceil(virtualSize[0] / mcuSize));
			const mcuRows = originAtCenter
				? 2 * Math.ceil(Math.max(0, virtualSize[1] / mcuSize - 1) / 2) + 1
				: Math.max(1, Math.ceil(virtualSize[1] / mcuSize));
			const gridSize = [mcuColumns * mcuSize, mcuRows * mcuSize];
			const mcuCount = mcuColumns * mcuRows;
			const blocksPerMcu = subsample ? 6 : 3;
			const coefficientBytes = mcuCount * blocksPerMcu * 64 * 4;
			const stateBytes = mcuCount * blocksPerMcu * 8;
			const maxBufferSize = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
			if (!Number.isSafeInteger(coefficientBytes) || coefficientBytes > maxBufferSize || stateBytes > maxBufferSize
				|| mcuColumns > device.limits.maxComputeWorkgroupsPerDimension || mcuRows > device.limits.maxComputeWorkgroupsPerDimension
				|| Math.ceil(mcuCount / 64) > device.limits.maxComputeWorkgroupsPerDimension) {
				// 無断で処理解像度を落とすと出力によって見た目が変わるため、設定の変更を求める。
				throw new Error('JPEG glitch: virtual image exceeds GPU resource limits. Increase Block size.');
			}
			return {
				virtualSize,
				gridSize,
				mcuColumns,
				mcuRows,
				mcuCount,
				blocksPerMcu,
				coefficientBytes,
				stateBytes,
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
				// 係数は符号付きかつ画像の範囲を超えるため、画像用の中間形式には保存しない。
				// 計算バッファ内でf32を保持し、IDCT後の出力だけ画像用形式へ変換する。
				const coefficients = createBuffer(geometry.coefficientBytes);
				const scanStates = createBuffer(geometry.stateBytes);
				const decoded = createBuffer(geometry.coefficientBytes);
				// 無効時はbindingを満たす1要素だけ確保し、追加の画像バッファは保持しない。
				const referenceSamples = createBuffer(preserveDetails ? geometry.coefficientBytes : 4);
				const coefficientEntry = { binding: 1, resource: { buffer: coefficients } };
				const scanEntry = { binding: 2, resource: { buffer: scanStates } };
				const decodedEntry = { binding: 3, resource: { buffer: decoded } };
				const referenceEntry = { binding: 4, resource: { buffer: referenceSamples } };
				return {
					mcuColumns: geometry.mcuColumns,
					mcuRows: geometry.mcuRows,
					blocksPerMcu: geometry.blocksPerMcu,
					preserveDetails,
					encodeGroup: device.createBindGroup({ layout: encodeLayout, entries: [uniformEntry, coefficientEntry, referenceEntry] }),
					scanGroup: device.createBindGroup({ layout: scanLayout, entries: [uniformEntry, scanEntry] }),
					decodeGroup: device.createBindGroup({ layout: decodeLayout, entries: [uniformEntry, coefficientEntry, scanEntry, decodedEntry] }),
					outputGroup: device.createBindGroup({ layout: outputLayout, entries: [uniformEntry, scanEntry, decodedEntry, referenceEntry] }),
					dispose: () => { for (const buffer of buffers) buffer.destroy(); },
				};
			} catch (error) {
				for (const buffer of buffers) buffer.destroy();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);

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
				const segmentLength = params.resynchronization ? clamp(Math.round(params.restartInterval), 1, geometry.mcuCount) : geometry.mcuCount;
				const minFrequency = clamp(Math.round(params.acMinFrequency), 1, 63);
				const maxFrequency = clamp(Math.round(params.acMaxFrequency), 1, 63);
				seedValue[0] = params.seed;
				uniformValues.set({
					virtualSize: geometry.virtualSize,
					gridSize: geometry.gridSize,
					originAtCenter: Number(originAtCenter),
					samplingGrid,
					mcuColumns: geometry.mcuColumns,
					mcuCount: geometry.mcuCount,
					blocksPerMcu: geometry.blocksPerMcu,
					subsample: Number(subsample),
					quantization: Number(params.quantization),
					// GPU側にも0〜1の値をそのまま渡し、Qualityの細かな変化を整数化で失わないようにする。
					quality: clamp(params.quality, 0, 1),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					dcEnabled: Number(params.dcCorruption),
					dcProbability: clamp(params.dcProbability, 0, 1),
					dcLuminance: Math.max(0, params.dcLuminance),
					dcChroma: Math.max(0, params.dcChroma),
					dcPropagation: Number(params.dcPropagation),
					dcRetention: clamp(params.dcRetention, 0, 1),
					acEnabled: Number(params.acCorruption),
					acProbability: clamp(params.acProbability, 0, 1),
					acCoefficientProbability: clamp(params.acCoefficientProbability, 0, 1),
					acMode: acModes[params.acMode],
					acStrength: clamp(params.acStrength, 0, 1),
					acMinFrequency: Math.min(minFrequency, maxFrequency),
					acMaxFrequency: Math.max(minFrequency, maxFrequency),
					acFrequencyShift: clamp(Math.round(params.acFrequencyShift), 0, 62),
					shiftEnabled: Number(params.blockShift),
					shiftProbability: clamp(params.shiftProbability, 0, 1),
					shiftAmount: clamp(Math.round(params.shiftAmount), 0, geometry.mcuCount),
					segmentLength,
					preserveDetails: Number(params.preserveDetails),
					inverseTransform: inverseTransforms[params.inverseTransform],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = getVariant(params.input);
				const inputGroup = variant.bindings.update({ input: params.input }, ctx.outputDataMap.output.texture);
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				compute.setPipeline(variant.encode);
				compute.setBindGroup(0, resources.encodeGroup);
				compute.setBindGroup(1, inputGroup);
				compute.dispatchWorkgroups(geometry.mcuColumns, geometry.mcuRows, geometry.blocksPerMcu);
				compute.setPipeline(scan);
				compute.setBindGroup(0, resources.scanGroup);
				compute.dispatchWorkgroups(Math.ceil(Math.ceil(geometry.mcuCount / segmentLength) / 64));
				compute.setPipeline(decode);
				compute.setBindGroup(0, resources.decodeGroup);
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
