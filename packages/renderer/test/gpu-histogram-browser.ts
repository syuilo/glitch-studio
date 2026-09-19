import { GpuHistogram } from '../src/utility/histogram/GpuHistogram.ts';

const status = document.querySelector<HTMLDivElement>('#status')!;
const canvas = document.querySelector<HTMLCanvasElement>('#histogram')!;

try {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const size = 100;
	const pixels = new Uint8Array(size * size * 4);
	for (let i = 0; i < pixels.length; i += 4) {
		pixels[i] = 64;
		pixels[i + 1] = 128;
		pixels[i + 2] = 192;
		pixels[i + 3] = 255;
	}

	const source = device.createTexture({
		size: [size, size],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
	});
	device.queue.writeTexture(
		{ texture: source },
		pixels,
		{ bytesPerRow: size * 4 },
		[size, size],
	);

	device.pushErrorScope('validation');
	const histogram = new GpuHistogram(
		device,
		canvas.getContext('webgpu')!,
		navigator.gpu.getPreferredCanvasFormat(),
	);
	const commandEncoder = device.createCommandEncoder();
	histogram.render(commandEncoder, source);
	device.queue.submit([commandEncoder.finish()]);
	await device.queue.onSubmittedWorkDone();
	const validationError = await device.popErrorScope();
	if (validationError) throw validationError;

	for (const format of ['bgra8unorm', 'r16float', 'r32float'] as const) {
		device.pushErrorScope('validation');
		const texture = device.createTexture({
			size: [size, size],
			format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		const encoder = device.createCommandEncoder();
		const clearPass = encoder.beginRenderPass({
			colorAttachments: [{
				view: texture.createView(),
				clearValue: { r: 0.5, g: 0.25, b: 0.75, a: 1 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		clearPass.end();
		histogram.render(encoder, texture);
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		const formatError = await device.popErrorScope();
		texture.destroy();
		if (formatError) throw new Error(`${format}: ${formatError.message}`);
	}

	status.textContent = 'PASS: rgba8unorm, bgra8unorm, r16float, r32float';
} catch (error) {
	status.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
	console.error(error);
}
