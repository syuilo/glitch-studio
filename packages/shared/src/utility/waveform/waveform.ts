import shader from './waveform.wgsl?raw';
import { createShaderInputBindings, generateShaderInputs } from '../../shader-input.ts';
import type { ShaderInput } from '../../shader-input.ts';

// エフェクトのパラメータ定義やCanvasに依存しない共通設定。
export type WaveformSettings = {
	mode: 'rgb' | 'luminance';
	direction: 'horizontal' | 'vertical';
	intensity: number;
	// fitを適用する画像領域。集計の間引きやグラフの縦横切替とは独立させる。
	fitSize: { width: number; height: number };
	// 波形の位置・強度の分解能と、入力を読むサンプル数は別々に指定できる。
	size: { width: number; height: number };
	sampleSize?: { width: number; height: number };
	showGrid?: boolean;
};

export function createWaveform(options: {
	device: GPUDevice;
	vertexShaderModule: GPUShaderModule;
	format: GPUTextureFormat;
}) {
	const { device } = options;
	const computeLayout = device.createBindGroupLayout({ entries: [
		{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
		{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
	] });
	const createVariant = (input: ShaderInput) => {
		const generated = generateShaderInputs({ input: 'color' }, { input }, 1, 'level0');
		const bindings = createShaderInputBindings(device, generated);
		try {
			const module = device.createShaderModule({ code: generated.code + '\n' + shader });
			const pipeline = device.createComputePipeline({
				layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, bindings.layout] }),
				compute: { module, entryPoint: 'accumulate' },
			});
			return { module, pipeline, bindings };
		} catch (error) {
			bindings.dispose();
			throw error;
		}
	};
	// uniform/textureの最大2構成。値や接続設定だけの変更ではpipelineを再生成しない。
	const variants = new Map<ShaderInput['kind'], ReturnType<typeof createVariant>>();
	let activeVariant: ReturnType<typeof createVariant> | null = null;
	let renderPipeline: GPURenderPipeline | null = null;
	const values = new ArrayBuffer(32);
	const integers = new Uint32Array(values);
	const floats = new Float32Array(values);
	const uniforms = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const uniformEntry = { binding: 0, resource: { buffer: uniforms } };
	let counts: GPUBuffer | null = null;
	let capacity = 0;
	let computeGroup: GPUBindGroup | null = null;
	let inputGroup: GPUBindGroup | null = null;
	let outputGroup: GPUBindGroup | null = null;
	let drawable = false;

	return {
		// computeとrenderのパスは呼び出し側が作成し、計測や描画先の管理を維持する。
		prepare(input: ShaderInput, p: WaveformSettings, encoder: GPUCommandEncoder): boolean {
			drawable = false;
			const { width, height } = p.size;
			const samples = p.sampleSize ?? p.size;
			const byteLength = width * height * 3 * Uint32Array.BYTES_PER_ELEMENT;
			if (![width, height, samples.width, samples.height, p.fitSize.width, p.fitSize.height].every(value => Number.isSafeInteger(value) && value > 0)
				|| !Number.isSafeInteger(byteLength)
				|| byteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
				|| Math.ceil(samples.width / 16) > device.limits.maxComputeWorkgroupsPerDimension
				|| Math.ceil(samples.height / 16) > device.limits.maxComputeWorkgroupsPerDimension) return false;
			let variant = variants.get(input.kind);
			if (variant == null) {
				variant = createVariant(input);
				variants.set(input.kind, variant);
			}
			activeVariant = variant;
			inputGroup = variant.bindings.update({ input }, p.fitSize);
			// 描画は集計結果だけを読むため、最初のmoduleから作ったpipelineを両構成で共有する。
			renderPipeline ??= device.createRenderPipeline({
				layout: 'auto',
				vertex: { module: options.vertexShaderModule },
				fragment: { module: variant.module, entryPoint: 'fs', targets: [{ format: options.format }] },
				primitive: { topology: 'triangle-list' },
			});
			if (capacity !== byteLength) {
				counts?.destroy();
				counts = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
				capacity = byteLength;
				computeGroup = device.createBindGroup({ layout: computeLayout, entries: [
					uniformEntry, { binding: 2, resource: { buffer: counts } },
				] });
				outputGroup = device.createBindGroup({
					layout: renderPipeline.getBindGroupLayout(0),
					entries: [uniformEntry, { binding: 3, resource: { buffer: counts } }],
				});
			}
			integers[0] = Number(p.mode === 'luminance');
			floats[1] = Math.max(0, p.intensity);
			integers.set([width, height, Number(p.direction === 'vertical'), Number(p.showGrid ?? false), samples.width, samples.height], 2);
			device.queue.writeBuffer(uniforms, 0, values);
			encoder.clearBuffer(counts!);
			drawable = true;
			return true;
		},
		accumulate(pass: GPUComputePassEncoder) {
			if (!drawable || activeVariant == null || computeGroup == null || inputGroup == null) return;
			pass.setPipeline(activeVariant.pipeline);
			pass.setBindGroup(0, computeGroup);
			pass.setBindGroup(1, inputGroup);
			pass.dispatchWorkgroups(Math.ceil(integers[6] / 16), Math.ceil(integers[7] / 16));
		},
		render(pass: GPURenderPassEncoder) {
			if (!drawable || renderPipeline == null || outputGroup == null) return;
			pass.setPipeline(renderPipeline);
			pass.setBindGroup(0, outputGroup);
			pass.draw(6);
		},
		dispose() {
			for (const variant of variants.values()) variant.bindings.dispose();
			variants.clear();
			counts?.destroy();
			uniforms.destroy();
		},
	};
}
