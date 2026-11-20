import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import commonCode, { uniforms } from '../../src/fx/vhsPlayback/common.shader.ts?shader';
import playbackCode from '../../src/fx/vhsPlayback/playback.wgsl?raw';
import { createVhsHeadSpacingFilters } from '../../src/fx/vhsPlayback/head-spacing.ts';
import { VHS_SIGNAL } from '../../src/fx/vhsPlayback/signal.ts';

export async function checkHeadSpacingOnGpu(device: GPUDevice) {
	const buffers: GPUBuffer[] = [];
	const createBuffer = (size: number, usage: GPUBufferUsageFlags) => {
		const buffer = device.createBuffer({ size, usage });
		buffers.push(buffer);
		return buffer;
	};
	const sampleCount = VHS_SIGNAL.rfSamples * 2;
	const records = new Float32Array(sampleCount);
	const surface = new Float32Array(sampleCount * 4);
	const signalUniforms = createShaderBuffer(uniforms.uniforms);
	const coefficients = createVhsHeadSpacingFilters();
	try {
		const uniform = createBuffer(signalUniforms.arrayBuffer.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
		const recorded = createBuffer(records.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
		const received = createBuffer(records.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
		const surfaceBuffer = createBuffer(surface.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
		const filterBuffer = createBuffer(coefficients.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
		const readback = createBuffer(records.byteLength, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
		device.queue.writeBuffer(uniform, 0, signalUniforms.arrayBuffer);
		device.queue.writeBuffer(filterBuffer, 0, coefficients);
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			...[5, 6, 12, 13].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' as const } })),
		] });
		const group = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniform } }, { binding: 5, resource: { buffer: recorded } },
			{ binding: 6, resource: { buffer: received } }, { binding: 12, resource: { buffer: surfaceBuffer } }, { binding: 13, resource: { buffer: filterBuffer } },
		] });
		const pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module: device.createShaderModule({ code: commonCode + '\n' + playbackCode }), entryPoint: 'readTape' } });
		for (const cycles of [40, 250]) {
			const frequency = cycles / VHS_SIGNAL.linePeriod;
			for (let index = 0; index < sampleCount; index++) records[index] = Math.cos(2 * Math.PI * cycles * index / VHS_SIGNAL.rfSamples);
			device.queue.writeBuffer(recorded, 0, records);
			for (const separation of [0, 0.125, 0.18, 0.5, 1]) {
				for (let index = 0; index < sampleCount; index++) surface.set([index, 1, separation, 1], index * 4);
				device.queue.writeBuffer(surfaceBuffer, 0, surface);
				const encoder = device.createCommandEncoder();
				const pass = encoder.beginComputePass();
				pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(32); pass.end();
				encoder.copyBufferToBuffer(received, 0, readback, 0, records.byteLength);
				device.queue.submit([encoder.finish()]);
				await readback.mapAsync(GPUMapMode.READ);
				let amplitude = 0;
				try {
					const values = new Float32Array(readback.getMappedRange());
					// 端の畳み込みを避け、整数周期を含む中央1024サンプルから振幅を直接測る。
					for (let index = 512; index < 1536; index++) amplitude += values[index] * records[index] * 2 / 1024;
				} finally { readback.unmap(); }
				const expected = Math.exp(-2 * Math.PI * separation * frequency / VHS_SIGNAL.fmReferenceFrequency);
				const errorDb = Math.abs(20 * Math.log10(amplitude / expected));
				if (!Number.isFinite(errorDb) || errorDb > 0.55) throw new Error(`GPU spacing response: ${frequency} Hz, ${separation} wavelengths, error ${errorDb} dB`);
			}
		}
	} finally {
		for (const buffer of buffers) buffer.destroy();
	}
}
