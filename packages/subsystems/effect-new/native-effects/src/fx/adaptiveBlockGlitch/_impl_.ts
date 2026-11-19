import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createFixedInputBindings } from '../../shader-input.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import commonCode, { uniforms as commonCodeUniforms } from './common.wgsl?shader';
import analyzeCode from './analyze.wgsl?raw';
import reduceCode from './reduce.wgsl?raw';
import outputCode from './shader.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const maxSubdivisionLevels = 8;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, defaultVertexShaderModule, resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const shortSide = Math.min(resolution.width, resolution.height);
		const aspect = [resolution.width / shortSide, resolution.height / shortSide];
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
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
		const reducers = Array.from({ length: maxSubdivisionLevels }, (_, level) => device.createComputePipeline({
			layout: reduceLayout,
			compute: { module: reduceModule, entryPoint: 'reduce', constants: { reductionLevel: level } },
		}));

		function createPipelines() {
			const bindings = createFixedInputBindings(device, { input: 'color' }, params, context.resolution, 1, 'level0');
			try {
				const prefix = bindings.code + '\n' + commonCode + '\n';
				const analyze = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: prefix + analyzeCode }), entryPoint: 'analyze' },
				});
				const output = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
					primitive: { topology: 'triangle-list' },
				});
				return { analyze, output, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}

		const pipelines = createPipelines();
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
			cacheKey: 0,
			render({ commandEncoder }) {
				const geometry = getGeometry(params.maxBlockSize * getSizeReferenceLength(params.sizeReference, resolution) / shortSide, params.subdivisions);
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
				// 解析と出力で同じfit/wrap/filterを適用する。解析グリッドの寸法をfitの基準にはしない。
				const inputGroup = pipelines.bindings.getBindGroup();
				if ((amount > 0 && strength > 0) || outline > 0) {
					const finest = geometry.levels[geometry.maxDepth];
					const compute = commandEncoder.beginComputePass();
					compute.setPipeline(pipelines.analyze);
					compute.setBindGroup(0, resources.computeGroup);
					compute.setBindGroup(1, inputGroup);
					compute.dispatchWorkgroups(Math.ceil(finest.width / 8), Math.ceil(finest.height / 8));
					for (let level = geometry.maxDepth - 1; level >= 0; level--) {
						const size = geometry.levels[level];
						compute.setPipeline(reducers[level]);
						compute.setBindGroup(0, resources.computeGroup);
						compute.dispatchWorkgroups(Math.ceil(size.width / 8), Math.ceil(size.height / 8));
					}
					compute.end();
				}
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
