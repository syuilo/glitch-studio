import colorSpaceShader from '../../gpu/color-space.wgsl?raw';
import imageValueScaleShader from '../../gpu/image-value-scale.wgsl?raw';
import imageAnalysisShader from '../../gpu/image-analysis.wgsl?raw';
import { IMAGE_ANALYSIS_MODES, resolveImageAnalysisValueScale } from '../image-analysis.ts';
import { DEFAULT_IMAGE_VALUE_RANGE, IMAGE_VALUE_SCALES, isDrawableImageValueRange } from '../image-value-scale.ts';
import { createShaderInputBindings, generateShaderInputs } from '../../gpu/shader-input.ts';
import { getImageAnalysisChunkCount } from '../image-analysis-accumulation.ts';
import shader from './waveform.wgsl?raw';
import type { ImageValueRange, ImageValueScale } from '../image-value-scale.ts';
import type { ImageAnalysisMode } from '../image-analysis.ts';
import type { ShaderInput } from '../../gpu/shader-input.ts';

// エフェクトのパラメータ定義やCanvasに依存しない共通設定。
export type WaveformSettings = {
	mode: ImageAnalysisMode;
	direction: 'horizontal' | 'vertical';
	intensity: number;
	valueScale?: ImageValueScale;
	valueRange?: ImageValueRange;
	// fitを適用する画像領域。集計の間引きやグラフの縦横切替とは独立させる。
	fitSize: { width: number; height: number };
	// 波形の位置・強度の分解能と、入力を読むサンプル数は別々に指定できる。
	size: { width: number; height: number };
	sampleSize?: { width: number; height: number };
	// 画像の位置方向と、指定値域で正規化した後の値方向を、それぞれ0〜1で切り出す。
	positionRange?: ImageValueRange;
	valueWindow?: ImageValueRange;
};

export function getWaveformMaximumPositionSamplesPerBin(positionSamples: number, columns: number, range: ImageValueRange = DEFAULT_IMAGE_VALUE_RANGE): number {
	if (range.minimum === 0 && range.maximum === 1) return Math.ceil(positionSamples / columns);
	// 端の画素は画素中心が表示範囲外でも、そのセルが範囲と重なるなら含める。
	// 部分的に重なる画素とfloat32の境界丸めを見込み、部分和の番号が上限を超えないようにする。
	return Math.min(positionSamples, Math.ceil(positionSamples * (range.maximum - range.minimum) / columns) + 2);
}

export function createWaveform(options: {
	device: GPUDevice;
	vertexShaderModule: GPUShaderModule;
	format: GPUTextureFormat;
}) {
	const { device } = options;
	const computeLayout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		],
	});
	let reduceLayout: GPUBindGroupLayout | null = null;
	const createVariant = (input: ShaderInput) => {
		const generated = generateShaderInputs({ input: 'color' }, { input }, 1, 'level0');
		const bindings = createShaderInputBindings(device, generated);
		try {
			const module = device.createShaderModule({ code: generated.code + '\n' + colorSpaceShader + '\n' + imageValueScaleShader + '\n' + imageAnalysisShader + '\n' + shader });
			return { module, bindings, pipelines: new Map<number, GPUComputePipeline>() };
		} catch (error) {
			bindings.dispose();
			throw error;
		}
	};
	// uniform/textureそれぞれの入力バッファを、直接/分割の両pipelineで共有する。
	// 分割用pipelineも初めて必要になった時点でだけ作る。
	const variants = new Map<ShaderInput['kind'], ReturnType<typeof createVariant>>();
	let activePipeline: GPUComputePipeline | null = null;
	const renderPipelines = new Map<boolean, GPURenderPipeline>();
	let renderPipeline: GPURenderPipeline | null = null;
	let reducePipeline: GPUComputePipeline | null = null;
	const values = new ArrayBuffer(64);
	const integers = new Uint32Array(values);
	const floats = new Float32Array(values);
	const uniforms = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const uniformEntry = { binding: 0, resource: { buffer: uniforms } };
	let counts: GPUBuffer | null = null;
	let waveformValues: GPUBuffer | null = null;
	let capacity = 0;
	let partialCapacity = 0;
	let computeGroup: GPUBindGroup | null = null;
	let reduceGroup: GPUBindGroup | null = null;
	let inputGroup: GPUBindGroup | null = null;
	let outputGroup: GPUBindGroup | null = null;
	let drawable = false;

	return {
		// computeとrenderのパスは呼び出し側が作成し、計測や描画先の管理を維持する。
		prepare(input: ShaderInput, p: WaveformSettings, encoder: GPUCommandEncoder): boolean {
			drawable = false;
			const { width, height } = p.size;
			const samples = p.sampleSize ?? p.size;
			const valueRange = p.valueRange ?? DEFAULT_IMAGE_VALUE_RANGE;
			const positionRange = p.positionRange ?? DEFAULT_IMAGE_VALUE_RANGE;
			const valueWindow = p.valueWindow ?? DEFAULT_IMAGE_VALUE_RANGE;
			const usePositionRange = positionRange.minimum !== 0 || positionRange.maximum !== 1;
			const useValueWindow = valueWindow.minimum !== 0 || valueWindow.maximum !== 1;
			const byteLength = width * height * 3 * Uint32Array.BYTES_PER_ELEMENT;
			const columns = p.direction === 'vertical' ? height : width;
			const positionSamples = p.direction === 'vertical' ? samples.height : samples.width;
			const otherSamples = p.direction === 'vertical' ? samples.width : samples.height;
			// 一つの位置ビンに入る最大サンプル数から判定する。全画素数を使うと、
			// 十分な位置ビンがある通常の画像まで分割集計にしてしまう。
			const chunkCount = getImageAnalysisChunkCount(getWaveformMaximumPositionSamplesPerBin(positionSamples, columns, positionRange) * otherSamples);
			const usePartialSums = chunkCount > 1;
			const partialByteLength = byteLength * chunkCount;
			if (!isDrawableImageValueRange(valueRange)
				|| ![positionRange, valueWindow].every(range => Number.isFinite(range.minimum) && Number.isFinite(range.maximum)
					&& range.minimum >= 0 && range.maximum <= 1 && range.minimum < range.maximum)
				|| ![width, height, samples.width, samples.height, p.fitSize.width, p.fitSize.height].every(value => Number.isSafeInteger(value) && value > 0)
				|| !Number.isSafeInteger(byteLength)
				|| byteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
				|| partialByteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
				|| Math.ceil(samples.width / 16) > device.limits.maxComputeWorkgroupsPerDimension
				|| Math.ceil(samples.height / 16) > device.limits.maxComputeWorkgroupsPerDimension) return false;
			let variant = variants.get(input.kind);
			if (variant == null) {
				variant = createVariant(input);
				variants.set(input.kind, variant);
			}
			// 直接/分割・位置の切り出し・値の切り出しをそれぞれpipeline定数で特殊化する。
			// 全体表示の通常経路に、ズーム用の除算や分岐を残さない。
			const pipelineVariant = Number(usePartialSums) | (Number(usePositionRange) << 1) | (Number(useValueWindow) << 2);
			activePipeline = variant.pipelines.get(pipelineVariant) ?? null;
			if (activePipeline == null) {
				activePipeline = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, variant.bindings.layout] }),
					compute: { module: variant.module, entryPoint: 'accumulate', constants: {
						usePartialSums: Number(usePartialSums), usePositionRange: Number(usePositionRange), useValueWindow: Number(useValueWindow),
					} },
				});
				variant.pipelines.set(pipelineVariant, activePipeline);
			}
			if (usePartialSums) {
				reduceLayout ??= device.createBindGroupLayout({ entries: [
					{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
					{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
					{ binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				] });
				reducePipeline ??= device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [reduceLayout] }), compute: { module: variant.module, entryPoint: 'reduceCounts' },
				});
			}
			inputGroup = variant.bindings.update({ input }, p.fitSize);
			// 描画は集計結果だけを読むため、最初のmoduleから作ったpipelineを両構成で共有する。
			renderPipeline = renderPipelines.get(usePartialSums) ?? null;
			if (renderPipeline == null) {
				renderPipeline = device.createRenderPipeline({
					layout: 'auto', vertex: { module: options.vertexShaderModule },
					fragment: { module: variant.module, entryPoint: 'fs', constants: { usePartialSums: Number(usePartialSums) }, targets: [{ format: options.format }] },
					primitive: { topology: 'triangle-list' },
				});
				renderPipelines.set(usePartialSums, renderPipeline);
			}
			if (capacity !== byteLength || partialCapacity !== partialByteLength) {
				counts?.destroy();
				waveformValues?.destroy();
				counts = device.createBuffer({ label: 'waveform counts', size: partialByteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
				// 安全な直接集計では、描画も同じu32バッファを読み、追加の出力バッファを持たない。
				waveformValues = usePartialSums ? device.createBuffer({ label: 'waveform reduced counts', size: byteLength, usage: GPUBufferUsage.STORAGE }) : null;
				capacity = byteLength;
				partialCapacity = partialByteLength;
				computeGroup = device.createBindGroup({
					layout: computeLayout,
					entries: [uniformEntry, { binding: 2, resource: { buffer: counts } }],
				});
				reduceGroup = waveformValues == null || reduceLayout == null ? null : device.createBindGroup({ layout: reduceLayout, entries: [
					uniformEntry, { binding: 2, resource: { buffer: counts } }, { binding: 4, resource: { buffer: waveformValues } },
				] });
				outputGroup = device.createBindGroup({
					layout: renderPipeline.getBindGroupLayout(0),
					entries: [uniformEntry, { binding: 3, resource: { buffer: waveformValues ?? counts } }],
				});
			}
			integers[0] = IMAGE_ANALYSIS_MODES.indexOf(p.mode);
			floats[1] = Math.max(0, p.intensity);
			integers.set([width, height, samples.width, samples.height, Number(p.direction === 'vertical')], 2);
			integers[7] = IMAGE_VALUE_SCALES.indexOf(resolveImageAnalysisValueScale(p.mode, p.valueScale ?? 'srgb'));
			floats.set([valueRange.minimum, valueRange.maximum], 8);
			integers[10] = chunkCount;
			floats.set([positionRange.minimum, positionRange.maximum, valueWindow.minimum, valueWindow.maximum], 12);
			device.queue.writeBuffer(uniforms, 0, values);
			if (counts == null) return false;
			encoder.clearBuffer(counts);
			drawable = true;
			return true;
		},
		accumulate(pass: GPUComputePassEncoder) {
			if (!drawable || activePipeline == null || computeGroup == null || inputGroup == null) return;
			pass.setPipeline(activePipeline);
			pass.setBindGroup(0, computeGroup);
			pass.setBindGroup(1, inputGroup);
			pass.dispatchWorkgroups(Math.ceil(integers[4] / 16), Math.ceil(integers[5] / 16));
			if (reduceGroup == null || reducePipeline == null) return;
			pass.setPipeline(reducePipeline);
			pass.setBindGroup(0, reduceGroup);
			const groups = Math.ceil(capacity / 4 / 256);
			const groupsX = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
			pass.dispatchWorkgroups(groupsX, Math.ceil(groups / groupsX));
		},
		render(pass: GPURenderPassEncoder) {
			if (!drawable || renderPipeline == null || outputGroup == null) return;
			pass.setPipeline(renderPipeline);
			pass.setBindGroup(0, outputGroup);
			pass.draw(3);
		},
		dispose() {
			for (const variant of variants.values()) variant.bindings.dispose();
			variants.clear();
			counts?.destroy();
			waveformValues?.destroy();
			uniforms.destroy();
		},
	};
}
