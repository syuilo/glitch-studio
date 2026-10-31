import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputBindings, generateShaderInputs, inputUvScale, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import transplantCode from './transplant.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type { ShaderInput, ShaderInputValues } from '@gs/shared/gpu/shader-input.ts';
import type definition from './_def_.ts';

const inputSchema = { input: 'color', donor: 'color' } as const;
const componentModes = { all: 0, luminance: 1, chroma: 2 };
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
		const createVariant = (inputs: ShaderInputValues<typeof inputSchema>) => {
			// computeでの面積サンプリングと、fragmentでの元画像の取得に同じ入力設定を使う。
			const generated = generateShaderInputs(inputSchema, inputs, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const prefix = generated.code + '\n' + commonCode + '\n';
				const transplant = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: prefix + transplantCode }), entryPoint: 'transplant' },
				});
				const output = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [outputLayout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: prefix + outputCode }), entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
					primitive: { topology: 'triangle-list' },
				});
				return { transplant, output, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		};
		// 入力2個の定数／テクスチャの組合せは最大4通り。値やfit/wrap/filterだけの変更では再生成しない。
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
		const getGeometry = (blockSize: number, referenceLength: number) => {
			if (!Number.isFinite(blockSize) || blockSize <= 0) throw new Error('Frequency transplant: block size must be a positive finite number.');
			// ブロックの見た目の大きさを基準寸法の百分率で定め、出力解像度によらず同じ周波数帯を扱う。
			// 浮動小数点の仮想寸法を保ち、計算領域だけ8サンプル単位に切り上げる。
			const scale = (8 * 100 / blockSize) / referenceLength;
			const virtualSize = [resolution.width * scale, resolution.height * scale];
			const columns = Math.max(1, Math.ceil(virtualSize[0] / 8));
			const rows = Math.max(1, Math.ceil(virtualSize[1] / 8));
			// 各サンプルに未加工の成分と移植の差分をvec4fずつ保存する。係数や差分は負になり得る。
			const byteLength = columns * rows * 64 * 32;
			if (!Number.isSafeInteger(byteLength) || byteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
				|| columns > device.limits.maxComputeWorkgroupsPerDimension || rows > device.limits.maxComputeWorkgroupsPerDimension) {
				throw new Error('Frequency transplant: virtual image exceeds GPU resource limits. Increase Block size.');
			}
			return {
				virtualSize,
				columns,
				rows,
				byteLength,
			};
		};
		const createResources = (geometry: ReturnType<typeof getGeometry>) => {
			const buffer = device.createBuffer({ size: geometry.byteLength, usage: GPUBufferUsage.STORAGE });
			try {
				const sampleEntry = { binding: 1, resource: { buffer } };
				return {
					columns: geometry.columns,
					rows: geometry.rows,
					computeGroup: device.createBindGroup({ layout: computeLayout, entries: [uniformEntry, sampleEntry] }),
					outputGroup: device.createBindGroup({ layout: outputLayout, entries: [uniformEntry, sampleEntry] }),
					dispose: () => buffer.destroy(),
				};
			} catch (error) {
				buffer.destroy();
				throw error;
			}
		};
		const getSamplingGrid = (input: ShaderInput, virtualSize: readonly number[]) => {
			if (input.kind === 'uniform') return [1, 1];
			// 各入力のfitを考慮して縮小範囲を分割する。異なる原寸の画像を混ぜても同じ仮想座標へ合わせる。
			const scale = inputUvScale(input.texture, resolution, input.fitMode);
			return [
				clamp(Math.ceil(input.texture.width * scale[0] / virtualSize[0]), 1, 16),
				clamp(Math.ceil(input.texture.height * scale[1] / virtualSize[1]), 1, 16),
			];
		};
		let resources: ReturnType<typeof createResources> | null = null;
		return {
			render: ctx => {
				const params = ctx.params;
				const geometry = getGeometry(params.blockSize, getSizeReferenceLength(params.sizeReference, resolution));
				if (resources == null || resources.columns !== geometry.columns || resources.rows !== geometry.rows) {
					const next = createResources(geometry);
					resources?.dispose();
					resources = next;
				}
				const minFrequency = clamp(params.minFrequency, 0, 1);
				const maxFrequency = clamp(params.maxFrequency, 0, 1);
				uniformValues.set({
					virtualSize: geometry.virtualSize,
					inputSamplingGrid: getSamplingGrid(params.input, geometry.virtualSize),
					donorSamplingGrid: getSamplingGrid(params.donor, geometry.virtualSize),
					donorOffset: params.donorOffset,
					blockColumns: geometry.columns,
					minFrequency: Math.min(minFrequency, maxFrequency),
					maxFrequency: Math.max(minFrequency, maxFrequency),
					softness: clamp(params.softness, 0, 1),
					components: componentModes[params.components],
					includeDc: Number(params.includeDc),
					donorGain: Math.max(0, params.donorGain),
					preserveDetails: Number(params.preserveDetails),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const inputs = { input: params.input, donor: params.donor };
				const variant = getVariant(inputs);
				const inputGroup = variant.bindings.update(inputs, ctx.outputDataMap.output.texture);
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				compute.setPipeline(variant.transplant);
				compute.setBindGroup(0, resources.computeGroup);
				compute.setBindGroup(1, inputGroup);
				compute.dispatchWorkgroups(geometry.columns, geometry.rows);
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
