import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { constantShaderInput, createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import samplingCode from './sampling.wgsl?raw';
import analyzeCode from './analyze.wgsl?raw';
import sortCode from './sort.wgsl?raw';
import outputCode from './shader.wgsl?raw';
import type definition from './_def_.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
const inputSchema = { input: 'color', customSortKey: 'scalar' } as const;
const sortKeys = { luminance: 0, red: 1, green: 2, blue: 3, alpha: 4, saturation: 5, custom: 6 };

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
		const uniformSize = uniformValues.arrayBuffer.byteLength;
		const uniformStride = Math.ceil(uniformSize / device.limits.minUniformBufferOffsetAlignment) * device.limits.minUniformBufferOffsetAlignment;
		const inactiveCustomKey = constantShaderInput('scalar', 0);
		const analyzeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const outputLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const sortModule = device.createShaderModule({ code: commonCode + '\n' + sortCode });
		const initialize = device.createComputePipeline({ layout: 'auto', compute: { module: sortModule, entryPoint: 'initialize' } });
		const merge = device.createComputePipeline({ layout: 'auto', compute: { module: sortModule, entryPoint: 'merge' } });
		const createVariant = (inputs: { input: ShaderInput; customSortKey: ShaderInput }) => {
			const generated = generateShaderInputs(inputSchema, inputs, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const prefix = generated.code + '\n' + commonCode + '\n' + samplingCode + '\n';
				return {
					bindings,
					analyze: device.createComputePipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [analyzeLayout, bindings.layout] }),
						compute: { module: device.createShaderModule({ code: prefix + analyzeCode }), entryPoint: 'analyze' },
					}),
					output: device.createRenderPipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
						vertex: { module: defaultVertexShaderModule },
						fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
						primitive: { topology: 'triangle-list' },
					}),
				};
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		};
		const variants = new Map<string, ReturnType<typeof createVariant>>();
		const getVariant = (inputs: { input: ShaderInput; customSortKey: ShaderInput }) => {
			const key = shaderInputVariantKey(inputSchema, inputs);
			let variant = variants.get(key);
			if (variant == null) {
				variant = createVariant(inputs);
				variants.set(key, variant);
			}
			return variant;
		};
		const getGrid = (params: Parameters) => {
			const referenceLength = getSizeReferenceLength(params.sizeReference, resolution);
			const cellPixels = params.frequency.map(value => referenceLength / (Number.isFinite(value) ? Math.max(0.01, value) : 0.01));
			// 整数周期のPhaseは同じ格子なので先に除く。大きな値による中心座標の桁落ちも避ける。
			const phase = params.phase.map(value => Number.isFinite(value) ? value - Math.floor(value) : 0);
			const horizontalPeriods = resolution.width / cellPixels[0];
			const verticalPeriods = resolution.height / cellPixels[1];
			const firstColumn = Math.floor(-horizontalPeriods * 0.5 + phase[0]);
			const firstRow = Math.floor(-verticalPeriods * 0.5 + phase[1]);
			const lastColumn = Math.ceil(horizontalPeriods * 0.5 + phase[0]);
			const lastRow = Math.ceil(verticalPeriods * 0.5 + phase[1]);
			const columns = lastColumn - firstColumn;
			const rows = lastRow - firstRow;
			const cellCount = columns * rows;
			const storageLimit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
			// 統計は32byte、ソート用の各bufferは12byte/セル。出力解像度で解析精度を落とさない。
			// 行・列の両方向へ切り替えられるよう、mergeの二次元dispatch上限も先に確認する。
			if (!Number.isSafeInteger(cellCount) || columns < 1 || rows < 1 || cellCount * 32 > storageLimit
				|| columns > device.limits.maxComputeWorkgroupsPerDimension || rows > device.limits.maxComputeWorkgroupsPerDimension) {
				throw new Error('Cell Sort: cell grid exceeds GPU resource limits. Decrease Frequency or change Size Reference.');
			}
			return {
				columns,
				rows,
				cellCount,
				cellSize: [cellPixels[0] / resolution.width, cellPixels[1] / resolution.height],
				// セルの定義は中央原点・+Yが上。bufferの行番号と画像参照だけ上から下へ並べる。
				origin: [(firstColumn - phase[0]) / horizontalPeriods + 0.5, 0.5 - (lastRow - phase[1]) / verticalPeriods],
			};
		};
		const createResources = (grid: ReturnType<typeof getGrid>) => {
			const maxPasses = Math.ceil(Math.log2(Math.max(grid.columns, grid.rows)));
			const uniformBytes = new Uint8Array(uniformStride * (maxPasses + 1));
			const uniformBuffer = device.createBuffer({ size: uniformBytes.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			const statistics = device.createBuffer({ size: grid.cellCount * 32, usage: GPUBufferUsage.STORAGE });
			const sortBuffers = [0, 1].map(() => device.createBuffer({ size: grid.cellCount * 12, usage: GPUBufferUsage.STORAGE }));
			const dispose = () => {
				uniformBuffer.destroy();
				statistics.destroy();
				for (const buffer of sortBuffers) buffer.destroy();
			};
			const uniformEntry = (slice: number) => ({ binding: 0, resource: { buffer: uniformBuffer, offset: slice * uniformStride, size: uniformSize } });
			const statisticsEntry = { binding: 1, resource: { buffer: statistics } };
			try {
				return {
					columns: grid.columns,
					rows: grid.rows,
					uniformBuffer,
					uniformBytes,
					analyzeGroup: device.createBindGroup({ layout: analyzeLayout, entries: [uniformEntry(0), statisticsEntry] }),
					initializeGroup: device.createBindGroup({ layout: initialize.getBindGroupLayout(0), entries: [uniformEntry(0), statisticsEntry, { binding: 3, resource: { buffer: sortBuffers[0] } }] }),
					mergeGroups: Array.from({ length: maxPasses }, (_, pass) => device.createBindGroup({
						layout: merge.getBindGroupLayout(0),
						entries: [uniformEntry(pass + 1), { binding: 2, resource: { buffer: sortBuffers[pass % 2] } }, { binding: 3, resource: { buffer: sortBuffers[1 - pass % 2] } }],
					})),
					outputGroups: sortBuffers.map(buffer => device.createBindGroup({ layout: outputLayout, entries: [uniformEntry(0), statisticsEntry, { binding: 2, resource: { buffer } }] })),
					dispose,
				};
			} catch (error) {
				dispose();
				throw error;
			}
		};
		let resources: ReturnType<typeof createResources> | null = null;
		return {
			render: ctx => {
				const params = ctx.params;
				const grid = getGrid(params);
				if (resources == null || resources.columns !== grid.columns || resources.rows !== grid.rows) {
					const nextResources = createResources(grid);
					resources?.dispose();
					resources = nextResources;
				}
				const vertical = params.direction === 'vertical';
				const length = vertical ? grid.rows : grid.columns;
				const lines = vertical ? grid.columns : grid.rows;
				const passes = Math.ceil(Math.log2(length));
				const lower = Number.isFinite(params.thresholdMin) ? params.thresholdMin : 0;
				const upper = Number.isFinite(params.thresholdMax) ? params.thresholdMax : 1;
				uniformValues.set({
					resolution: [resolution.width, resolution.height],
					cellSize: grid.cellSize,
					gridOrigin: grid.origin,
					gridSize: [grid.columns, grid.rows],
					length,
					lines,
					vertical: Number(vertical),
					descending: Number(params.order === 'descending'),
					sampleCount: Number.isFinite(params.samplesPerCell) ? Math.min(256, Math.max(1, Math.round(params.samplesPerCell))) : 16,
					sortBy: sortKeys[params.sortBy],
					thresholdMin: Math.min(lower, upper),
					thresholdMax: Math.max(lower, upper),
					flattenMovedCells: Number(params.flattenMovedCells),
				});
				// dispatchごとに別のuniform領域を使い、後段のmerge幅で前段まで上書きしない。
				for (let pass = 0; pass <= passes; pass++) {
					uniformValues.set({ mergeWidth: 2 ** Math.max(0, pass - 1) });
					resources.uniformBytes.set(new Uint8Array(uniformValues.arrayBuffer), pass * uniformStride);
				}
				device.queue.writeBuffer(resources.uniformBuffer, 0, resources.uniformBytes);
				const inputs = { input: params.input, customSortKey: params.sortBy === 'custom' ? params.customSortKey : inactiveCustomKey };
				const variant = getVariant(inputs);
				const inputGroup = variant.bindings.update(inputs, ctx.outputDataMap.output.texture);
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				compute.setPipeline(variant.analyze);
				compute.setBindGroup(0, resources.analyzeGroup);
				compute.setBindGroup(1, inputGroup);
				compute.dispatchWorkgroups(Math.ceil(grid.columns / 8), Math.ceil(grid.rows / 8));
				compute.setPipeline(initialize);
				compute.setBindGroup(0, resources.initializeGroup);
				compute.dispatchWorkgroups(Math.ceil(lines / 64));
				compute.setPipeline(merge);
				for (let pass = 0; pass < passes; pass++) {
					compute.setBindGroup(0, resources.mergeGroups[pass]);
					compute.dispatchWorkgroups(Math.ceil(length / 64), lines);
				}
				compute.end();
				const output = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				output.setPipeline(variant.output);
				output.setBindGroup(0, resources.outputGroups[passes % 2]);
				output.setBindGroup(1, inputGroup);
				output.draw(3);
				output.end();
			},
			dispose: () => {
				resources?.dispose();
				for (const variant of variants.values()) variant.bindings.dispose();
				variants.clear();
			},
		};
	},
});
