import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { CpuPreviewCanvasContext } from '../../src/preview-canvas-context.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const canvas = new OffscreenCanvas(2, 2);
	const createContext = (output: OffscreenCanvas) => new CpuPreviewCanvasContext(new OffscreenCanvas(output.width, output.height), frame => {
		const display = output.getContext('2d')!;
		display.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
	});
	const context = createContext(canvas);
	context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'premultiplied' });
	const analysisCanvases = [new OffscreenCanvas(256, 150), new OffscreenCanvas(512, 256), new OffscreenCanvas(256, 512)];
	const analysisContexts = analysisCanvases.map(createContext);
	const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context, enableWaveformAndHistogram: true,
		histogramGpuContext: analysisContexts[0], waveformHorizontalGpuContext: analysisContexts[1], waveformVerticalGpuContext: analysisContexts[2] });
	const texture = device.createTexture({ size: [2, 2], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
	try {
		device.queue.writeTexture({ texture }, new Uint8Array([128, 0, 0, 128, 0, 255, 0, 255, 0, 0, 0, 0, 64, 64, 64, 64]), { bytesPerRow: 8 }, [2, 2]);
		const encoder = device.createCommandEncoder(); renderer.renderToCanvas(texture, encoder); device.queue.submit([encoder.finish()]);
		await renderer.presentCpuFrame();
		const pixels = canvas.getContext('2d')!.getImageData(0, 0, 2, 2).data;
		const expected = [255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 64];
		for (let index = 0; index < expected.length; index++) if (Math.abs(pixels[index] - expected[index]) > 1) throw new Error(`CPU preview pixel ${index}: ${pixels[index]} != ${expected[index]}`);
		for (const output of analysisCanvases) {
			const data = output.getContext('2d')!.getImageData(0, 0, output.width, output.height).data;
			if (!data.some(value => value > 0)) throw new Error('Analysis canvas was not displayed');
		}
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return ['CPU preview color, alpha and orientation', 'Histogram CPU presentation', 'Horizontal waveform CPU presentation', 'Vertical waveform CPU presentation'];
	} finally { renderer.destroy(); texture.destroy(); device.destroy(); }
}
