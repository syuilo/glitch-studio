import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { CpuPreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import { createCanvasOutputConfigurator, createGpuPreviewCanvasOutputSettings, createSrgbCanvasOutputSettings } from '../../src/canvas-output.ts';

async function captureInWorker(canvas: OffscreenCanvas) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const checks: string[] = [];
	try {
		for (const mode of ['gpu', 'cpu'] as const) {
			let cpuContext: CpuPreviewCanvasContext | null = null;
			if (mode === 'cpu') cpuContext = new CpuPreviewCanvasContext(new OffscreenCanvas(160, 90), frame => cpuContext?.recyclePixels(frame.frameId, frame.pixels));
			const context = cpuContext ?? canvas.getContext('webgpu')!;
			const output = mode === 'gpu' ? createGpuPreviewCanvasOutputSettings() : createSrgbCanvasOutputSettings();
			createCanvasOutputConfigurator(device, context, output)('premultiplied');
			const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context, canvasOutput: output, enableWaveformAndHistogram: false });
			const texture = device.createTexture({ size: [160, 90], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
			const draw = async (color: number[], sequence: number) => {
				const pixels = new Uint8Array(160 * 90 * 4);
				for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(color, offset);
				device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 640 }, [160, 90]);
				const frame = await renderer.reserveCpuPreviewFrame();
				const encoder = device.createCommandEncoder();
				renderer.renderToCanvas(texture, encoder, sequence * 100, sequence);
				frame?.prepareReadback(encoder);
				device.queue.submit([encoder.finish()]);
				await (frame?.complete() ?? device.queue.onSubmittedWorkDone());
			};
			const read = async (captured: Awaited<ReturnType<CanvasRenderer['captureNextPreviewFrame']>>, expected: number[], time: number) => {
				if (captured == null || captured.blob.type !== 'image/png') throw new Error(`${mode}: missing PNG`);
				if (captured.width !== 64 || captured.height !== 36 || captured.time !== time) throw new Error(`${mode}: incorrect capture metadata`);
				const image = await createImageBitmap(captured.blob);
				try {
					if (image.width !== captured.width || image.height !== captured.height) throw new Error(`${mode}: PNG dimensions differ from metadata`);
					const readback = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
					readback.drawImage(image, 0, 0);
					const pixels = readback.getImageData(0, 0, image.width, image.height).data;
					for (let index = 0; index < pixels.length; index++) {
						if (Math.abs(pixels[index] - expected[index % 4]) > 1) throw new Error(`${mode}: PNG pixel ${index}: ${pixels[index]} != ${expected[index % 4]}`);
					}
				} finally { image.close(); }
			};
			try {
				await draw([255, 0, 0, 255], 1);
				let completed = false;
				const capture = renderer.captureNextPreviewFrame(64, 1).then(result => { completed = true; return result; });
				// 要求前に開始したフレームが遅れて完了しても、編集後の画像として採用しない。
				await draw([255, 0, 0, 255], 1);
				if (completed) throw new Error(`${mode}: captured an old frame`);
				renderer.previewExposure = -1;
				await draw([0, 255, 0, 255], 2);
				await read(await capture, [0, 188, 0, 255], 200);
				checks.push(`${mode}: fresh PNG frame with aspect ratio, metadata and exposure`);
				renderer.previewExposure = 0;
				const transparent = renderer.captureNextPreviewFrame(64, 2);
				await draw([128, 0, 0, 128], 3);
				await read(await transparent, [255, 0, 0, 128], 300);
				checks.push(`${mode}: PNG preserves premultiplied source transparency`);
				// uniform値は1×1の参照テクスチャで描くが、画像取得も表示先の縦横比を保つ。
				const uniformTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
				try {
					device.queue.writeTexture({ texture: uniformTexture }, new Uint8Array([0, 0, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
					const uniformCapture = renderer.captureNextPreviewFrame(64, 3);
					const encoder = device.createCommandEncoder();
					renderer.renderToCanvas(uniformTexture, encoder, 400, 4);
					device.queue.submit([encoder.finish()]);
					await read(await uniformCapture, [0, 0, 255, 255], 400);
					checks.push(`${mode}: uniform output keeps the visible preview aspect ratio`);
				} finally { uniformTexture.destroy(); }
				const cancelled = renderer.captureNextPreviewFrame(64, 4);
				renderer.clear();
				if (await cancelled !== null) throw new Error(`${mode}: cleared capture returned an image`);
				checks.push(`${mode}: renderer reset cancels pending capture`);
			} finally { renderer.destroy(); texture.destroy(); context.unconfigure(); }
		}
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally { device.destroy(); }
}

if (typeof document === 'undefined') {
	self.onmessage = async (event: MessageEvent<OffscreenCanvas>) => {
		try { self.postMessage({ checks: await captureInWorker(event.data) }); }
		catch (error) { self.postMessage({ error: String(error) }); }
	};
}

export async function run() {
	const worker = new Worker('/test.js', { type: 'module' });
	const canvas = new OffscreenCanvas(160, 90);
	try {
		return await new Promise<string[]>((resolve, reject) => {
			worker.onmessage = ({ data }) => data.error == null ? resolve(data.checks) : reject(new Error(data.error));
			worker.onerror = event => reject(new Error(event.message));
			worker.postMessage(canvas, [canvas]);
		});
	} finally { worker.terminate(); }
}
