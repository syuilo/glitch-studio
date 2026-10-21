import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import analyzeCode from './analyze.wgsl?raw';
import reduceCode from './reduce.wgsl?raw';
import outputCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const maxSubdivisionLevels = 8;
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
		const shortSide = Math.min(resolution.width, resolution.height);
		const aspect = [resolution.width / shortSide, resolution.height / shortSide];
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const computeLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		});
		const outputLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			],
		});
		const reduceModule = device.createShaderModule({ code: commonCode + '\n' + reduceCode });
		const reduceLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
		const reducers = new Map<number, GPUComputePipeline>();
		const getReducer = (level: number) => {
			let pipeline = reducers.get(level);
			if (pipeline == null) {
				// 階層ごとの指定をpipeline定数へ固定し、同じcommand encoder内で
				// uniformを書き換えて別の階層のdispatchまで上書きすることを避ける。
				pipeline = device.createComputePipeline({
					layout: reduceLayout,
					compute: { module: reduceModule, entryPoint: 'reduce', constants: { reductionLevel: level } },
				});
				reducers.set(level, pipeline);
			}
			return pipeline;
		};
		const createVariant = (input: ShaderInput) => {
			const generated = generateShaderInputs({ input: 'color' }, { input }, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const prefix = generated.code + '\n' + commonCode + '\n';
				const analyze = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: prefix + analyzeCode }), entryPoint: 'analyze' },
				});
				const output = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
					primitive: { topology: 'triangle-list' },
				});
				return { analyze, output, bindings };
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
		const getGeometry = (maxBlockSize: number, subdivisions: number) => {
			if (!Number.isFinite(maxBlockSize) || maxBlockSize <= 0 || !Number.isFinite(subdivisions)) {
				throw new Error('Adaptive block glitch: block size must be positive and subdivision levels must be finite.');
			}
			const rootSize = maxBlockSize / 100;
			const maxDepth = clamp(Math.round(subdivisions), 0, maxSubdivisionLevels);
			// 最大ブロックの1個を画像中央へ置き、必要な列・行を左右・上下へ同数ずつ足す。
			// 単純なceilで個数を決めると偶奇が変わるたびに半ブロックずれるため、常に奇数にする。
			const rootColumns = Math.max(1, 2 * Math.ceil((aspect[0] / rootSize - 1) / 2) + 1);
			const rootRows = Math.max(1, 2 * Math.ceil((aspect[1] / rootSize - 1) / 2) + 1);
			const gridOrigin = [(aspect[0] - rootColumns * rootSize) / 2, (aspect[1] - rootRows * rootSize) / 2];
			const levels: { offset: number; width: number; height: number }[] = [];
			let count = 0;
			for (let level = 0; level <= maxDepth; level++) {
				const width = rootColumns * 2 ** level;
				const height = rootRows * 2 ** level;
				levels.push({ offset: count, width, height });
				count += width * height;
			}
			const byteLength = count * 32;
			const finest = levels[maxDepth];
			if (!Number.isSafeInteger(byteLength) || byteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
				|| Math.ceil(finest.width / 8) > device.limits.maxComputeWorkgroupsPerDimension
				|| Math.ceil(finest.height / 8) > device.limits.maxComputeWorkgroupsPerDimension) {
				// 出力解像度に応じて解析精度を落とすと葉の配置が変わるため、設定値の変更を求める。
				throw new Error('Adaptive block glitch: analysis exceeds GPU resource limits. Increase Maximum block size or decrease Subdivision levels.');
			}
			const levelValues = new Uint32Array((maxSubdivisionLevels + 1) * 4);
			for (const [index, level] of levels.entries()) levelValues.set([level.offset, level.width, level.height, 0], index * 4);
			return {
				rootSize,
				rootColumns,
				rootRows,
				gridOrigin,
				maxDepth,
				levels,
				levelValues,
				byteLength,
			};
		};
		const createResources = (geometry: ReturnType<typeof getGeometry>) => {
			const statistics = device.createBuffer({ size: geometry.byteLength, usage: GPUBufferUsage.STORAGE });
			const statisticsEntry = { binding: 1, resource: { buffer: statistics } };
			try {
				return {
					rootColumns: geometry.rootColumns,
					rootRows: geometry.rootRows,
					maxDepth: geometry.maxDepth,
					computeGroup: device.createBindGroup({ layout: computeLayout, entries: [uniformEntry, statisticsEntry] }),
					outputGroup: device.createBindGroup({ layout: outputLayout, entries: [uniformEntry, statisticsEntry] }),
					dispose: () => statistics.destroy(),
				};
			} catch (error) {
				statistics.destroy();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);

		return {
			render: ctx => {
				const params = ctx.params;
				const geometry = getGeometry(params.maxBlockSize, params.subdivisions);
				if (resources == null || resources.rootColumns !== geometry.rootColumns || resources.rootRows !== geometry.rootRows || resources.maxDepth !== geometry.maxDepth) {
					const next = createResources(geometry);
					resources?.dispose();
					resources = next;
				}
				const amount = clamp(params.amount, 0, 1);
				const strength = clamp(params.strength, 0, 1);
				const outline = clamp(params.outline, 0, 0.5);
				seedValue[0] = params.seed;
				uniformValues.set({
					aspect,
					gridOrigin: geometry.gridOrigin,
					rootSize: geometry.rootSize,
					threshold: Math.max(0, params.threshold),
					maxDepth: geometry.maxDepth,
					analysisSamples: clamp(Math.round(params.analysisSamples), 1, 8),
					amount,
					strength,
					displacement: Math.max(0, params.displacement),
					colorShift: Math.max(0, params.colorShift),
					channelShift: Math.max(0, params.channelShift),
					outline,
					pixelSize: 1 / shortSide,
					snapToBlocks: Number(params.snapToBlocks),
					flattenBlocks: Number(params.flattenBlocks),
					preserveAlpha: Number(params.preserveAlpha),
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
					levels: geometry.levelValues,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = getVariant(params.input);
				// 解析と出力で同じfit/wrap/filterを適用する。解析グリッドの寸法をfitの基準にはしない。
				const inputGroup = variant.bindings.update({ input: params.input }, ctx.outputDataMap.output.texture);
				if ((amount > 0 && strength > 0) || outline > 0) {
					const finest = geometry.levels[geometry.maxDepth];
					const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
					compute.setPipeline(variant.analyze);
					compute.setBindGroup(0, resources.computeGroup);
					compute.setBindGroup(1, inputGroup);
					compute.dispatchWorkgroups(Math.ceil(finest.width / 8), Math.ceil(finest.height / 8));
					for (let level = geometry.maxDepth - 1; level >= 0; level--) {
						const size = geometry.levels[level];
						compute.setPipeline(getReducer(level));
						compute.setBindGroup(0, resources.computeGroup);
						compute.dispatchWorkgroups(Math.ceil(size.width / 8), Math.ceil(size.height / 8));
					}
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
