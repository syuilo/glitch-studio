import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import samplingCode from './sampling.wgsl?raw';
import analyzeCode from './analyze.wgsl?raw';
import matchCode from './match.wgsl?raw';
import outputCode from './shader.wgsl?raw';
import type definition from './_def_.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
const inputSchema = { input: 'color', reference: 'color' } as const;
type Inputs = { input: ShaderInput; reference: ShaderInput };

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
		const analyzeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const matchLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const outputLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const matchModule = device.createShaderModule({ code: commonCode + '\n' + matchCode });
		const matchPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [matchLayout] });
		const initialize = device.createComputePipeline({ layout: matchPipelineLayout, compute: { module: matchModule, entryPoint: 'initialize' } });
		const improve = device.createComputePipeline({ layout: matchPipelineLayout, compute: { module: matchModule, entryPoint: 'improve' } });
		const createVariant = (inputs: Inputs) => {
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
		const getVariant = (inputs: Inputs) => {
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
			// 整数周期のPhaseは同じ格子なので除き、大きな値による桁落ちを避ける。
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
			const participantCount = 2 ** Math.ceil(Math.log2(Math.max(2, cellCount)));
			const storageLimit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
			const dispatchLimit = device.limits.maxComputeWorkgroupsPerDimension;
			// 統計32byte/セルと割当4byte/セル。解像度に応じて格子や解析精度を間引かない。
			if (!Number.isSafeInteger(cellCount) || columns < 1 || rows < 1 || cellCount * 32 > storageLimit
				|| participantCount > 0xffffffff || Math.ceil(columns / 8) > dispatchLimit || Math.ceil(rows / 8) > dispatchLimit
				|| Math.ceil(cellCount / 64) > dispatchLimit ** 2 || Math.ceil(participantCount / 128) > dispatchLimit ** 2) {
				throw new Error('Cell Match: cell grid exceeds GPU resource limits. Decrease Frequency or change Size Reference.');
			}
			return {
				columns,
				rows,
				cellCount,
				participantCount,
				cellSize: [cellPixels[0] / resolution.width, cellPixels[1] / resolution.height],
				// 格子は中央原点・+Yが上。bufferの行と画像参照だけを上から下へ並べる。
				origin: [(firstColumn - phase[0]) / horizontalPeriods + 0.5, 0.5 - (lastRow - phase[1]) / verticalPeriods],
			};
		};
		const createResources = (grid: ReturnType<typeof getGrid>, iterationsCapacity: number) => {
			const uniformBytes = new Uint8Array(uniformStride * (iterationsCapacity + 1));
			const uniformBuffer = device.createBuffer({ size: uniformBytes.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			const statistics = device.createBuffer({ size: grid.cellCount * 32, usage: GPUBufferUsage.STORAGE });
			const assignments = device.createBuffer({ size: grid.cellCount * 4, usage: GPUBufferUsage.STORAGE });
			const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer, size: uniformSize } };
			const statisticsEntry = { binding: 1, resource: { buffer: statistics } };
			const dispose = () => {
				uniformBuffer.destroy();
				statistics.destroy();
				assignments.destroy();
			};
			try {
				return {
					columns: grid.columns,
					rows: grid.rows,
					iterationsCapacity,
					uniformBuffer,
					uniformBytes,
					analyzeGroup: device.createBindGroup({ layout: analyzeLayout, entries: [uniformEntry, statisticsEntry] }),
					matchGroup: device.createBindGroup({ layout: matchLayout, entries: [uniformEntry, statisticsEntry, { binding: 2, resource: { buffer: assignments } }] }),
					outputGroup: device.createBindGroup({ layout: outputLayout, entries: [uniformEntry, { binding: 1, resource: { buffer: assignments } }] }),
					dispose,
				};
			} catch (error) {
				dispose();
				throw error;
			}
		};
		const dispatchLinear = (compute: GPUComputePassEncoder, count: number) => {
			const workgroups = Math.ceil(count / 64);
			const columns = Math.min(workgroups, device.limits.maxComputeWorkgroupsPerDimension);
			compute.dispatchWorkgroups(columns, Math.ceil(workgroups / columns));
		};
		let resources: ReturnType<typeof createResources> | null = null;
		return {
			render: ctx => {
				const params = ctx.params;
				const grid = getGrid(params);
				const iterations = grid.cellCount === 1 ? 0 : Number.isFinite(params.iterations) ? Math.min(1024, Math.max(0, Math.round(params.iterations))) : 128;
				if (resources == null || resources.columns !== grid.columns || resources.rows !== grid.rows || resources.iterationsCapacity < iterations) {
					const nextResources = createResources(grid, iterations);
					resources?.dispose();
					resources = nextResources;
				}
				uniformValues.set({
					resolution: [resolution.width, resolution.height],
					cellSize: grid.cellSize,
					gridOrigin: grid.origin,
					gridSize: [grid.columns, grid.rows],
					cellCount: grid.cellCount,
					participantCount: grid.participantCount,
					sampleCount: Number.isFinite(params.samplesPerCell) ? Math.min(256, Math.max(1, Math.round(params.samplesPerCell))) : 16,
					matchBy: Number(params.matchBy === 'luminance'),
					positionBias: Number.isFinite(params.positionBias) ? Math.max(0, params.positionBias) : 0,
					matchRound: 0,
				});
				resources.uniformBytes.set(new Uint8Array(uniformValues.arrayBuffer), 0);
				const roundBits = Math.log2(grid.participantCount);
				for (let iteration = 0; iteration < iterations; iteration++) {
					// round番号のbitを反転して、少ない反復でも遠く離れたセルと比較する。
					// 2冪-1自身だけは反転後も同じ値なので、これを除いた全roundを重複なく巡回できる。
					let remaining = iteration % (grid.participantCount - 1);
					let matchRound = 0;
					for (let bit = 0; bit < roundBits; bit++) {
						matchRound = matchRound * 2 + remaining % 2;
						remaining = Math.floor(remaining / 2);
					}
					uniformValues.set({ matchRound });
					// queueへの投入前にuniformを上書きしても前のdispatchを変えないよう、各回の領域を分ける。
					resources.uniformBytes.set(new Uint8Array(uniformValues.arrayBuffer), (iteration + 1) * uniformStride);
				}
				device.queue.writeBuffer(resources.uniformBuffer, 0, resources.uniformBytes, 0, (iterations + 1) * uniformStride);
				const inputs = { input: params.input, reference: params.reference };
				const variant = getVariant(inputs);
				const inputGroup = variant.bindings.update(inputs, ctx.outputDataMap.output.texture);
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				if (iterations > 0) {
					compute.setPipeline(variant.analyze);
					compute.setBindGroup(0, resources.analyzeGroup);
					compute.setBindGroup(1, inputGroup);
					compute.dispatchWorkgroups(Math.ceil(grid.columns / 8), Math.ceil(grid.rows / 8));
				}
				compute.setPipeline(initialize);
				compute.setBindGroup(0, resources.matchGroup, [0]);
				dispatchLinear(compute, grid.cellCount);
				compute.setPipeline(improve);
				for (let iteration = 0; iteration < iterations; iteration++) {
					compute.setBindGroup(0, resources.matchGroup, [(iteration + 1) * uniformStride]);
					dispatchLinear(compute, grid.participantCount / 2);
				}
				compute.end();
				const output = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				output.setPipeline(variant.output);
				output.setBindGroup(0, resources.outputGroup);
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
