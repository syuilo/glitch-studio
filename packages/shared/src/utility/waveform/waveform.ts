import shader from './waveform.wgsl?raw';

// エフェクトのパラメータ定義やCanvasに依存しない共通設定。
export type WaveformSettings = {
	mode: 'rgb' | 'luminance';
	direction: 'horizontal' | 'vertical';
	intensity: number;
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
	const module = device.createShaderModule({ code: shader });
	const sampler = device.createSampler({
		minFilter: 'linear', magFilter: 'linear',
		addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
	});
	const computeLayout = device.createBindGroupLayout({ entries: [
		{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
		{ binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
		{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		{ binding: 4, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
	] });
	const accumulatePipeline = device.createComputePipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
		compute: { module, entryPoint: 'accumulate' },
	});
	const renderPipeline = device.createRenderPipeline({
		layout: 'auto',
		vertex: { module: options.vertexShaderModule },
		fragment: { module, entryPoint: 'fs', targets: [{ format: options.format }] },
		primitive: { topology: 'triangle-list' },
	});
	const values = new ArrayBuffer(32);
	const integers = new Uint32Array(values);
	const floats = new Float32Array(values);
	const uniforms = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const uniformEntry = { binding: 0, resource: { buffer: uniforms } };
	let counts: GPUBuffer | null = null;
	let capacity = 0;
	let source: GPUTexture | null = null;
	let inputGroup: GPUBindGroup | null = null;
	let outputGroup: GPUBindGroup | null = null;
	let drawable = false;

	return {
		// computeとrenderのパスは呼び出し側が作成し、計測や描画先の管理を維持する。
		prepare(input: GPUTexture | null, p: WaveformSettings, encoder: GPUCommandEncoder): boolean {
			drawable = false;
			const { width, height } = p.size;
			const samples = p.sampleSize ?? p.size;
			const byteLength = width * height * 3 * Uint32Array.BYTES_PER_ELEMENT;
			if (![width, height, samples.width, samples.height].every(value => Number.isSafeInteger(value) && value > 0)
				|| !Number.isSafeInteger(byteLength)
				|| byteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
				|| Math.ceil(samples.width / 16) > device.limits.maxComputeWorkgroupsPerDimension
				|| Math.ceil(samples.height / 16) > device.limits.maxComputeWorkgroupsPerDimension) return false;
			if (capacity !== byteLength) {
				counts?.destroy();
				counts = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
				capacity = byteLength;
				inputGroup = null;
				outputGroup = device.createBindGroup({
					layout: renderPipeline.getBindGroupLayout(0),
					entries: [uniformEntry, { binding: 3, resource: { buffer: counts } }],
				});
			}
			if (source !== input || inputGroup == null) {
				source = input;
				inputGroup = input == null ? null : device.createBindGroup({ layout: computeLayout, entries: [
					uniformEntry,
					{ binding: 1, resource: input.createView() },
					{ binding: 2, resource: { buffer: counts! } },
					{ binding: 4, resource: sampler },
				] });
			}
			integers[0] = Number(p.mode === 'luminance');
			floats[1] = Math.max(0, p.intensity);
			integers.set([width, height, Number(p.direction === 'vertical'), Number(p.showGrid ?? false), samples.width, samples.height], 2);
			device.queue.writeBuffer(uniforms, 0, values);
			encoder.clearBuffer(counts!);
			drawable = true;
			return inputGroup != null;
		},
		accumulate(pass: GPUComputePassEncoder) {
			if (!drawable || inputGroup == null) return;
			pass.setPipeline(accumulatePipeline);
			pass.setBindGroup(0, inputGroup);
			pass.dispatchWorkgroups(Math.ceil(integers[6] / 16), Math.ceil(integers[7] / 16));
		},
		render(pass: GPURenderPassEncoder) {
			if (!drawable || outputGroup == null) return;
			pass.setPipeline(renderPipeline);
			pass.setBindGroup(0, outputGroup);
			pass.draw(6);
		},
		dispose() { counts?.destroy(); uniforms.destroy(); },
	};
}
