import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { CpuPreviewCanvasContext, copyPreviewPixels } from '../../src/preview-canvas-context.ts';
import type { PreviewCanvasContext } from '../../src/preview-canvas-context.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const format = navigator.gpu.getPreferredCanvasFormat();
	const checks: string[] = [];
	const source = device.createTexture({ size: [2, 2], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
	// 正確に表せるhalf値で、半透明・HDR・伝達関数の線形区間・完全透明を一枚に含める。
	const pixels = new Uint16Array([0x3400, 0x3000, 0x2800, 0x3800, 0x4000, 0x3c00, 0x3800, 0x3c00,
		0x1400, 0x1c00, 0x2000, 0x3c00, 0, 0, 0, 0]);
	const straightPixels = [[0.5, 0.25, 0.0625, 0.5], [2, 1, 0.5, 1], [1 / 1024, 1 / 256, 1 / 128, 1], [0, 0, 0, 0]];

	function expose(value: number, ev: number) {
		const light = value * 2 ** ev;
		return light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055;
	}

	try {
		for (const mode of ['gpu', 'cpu'] as const) {
			device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: 16 }, [2, 2]);
			let cpuPixels: Uint8Array | null = null;
			const canvas = new OffscreenCanvas(2, 2);
			const context: PreviewCanvasContext = mode === 'cpu' ? new CpuPreviewCanvasContext(canvas, frame => {
				cpuPixels = new Uint8Array(frame.pixels);
				(context as CpuPreviewCanvasContext).recyclePixels(frame.frameId, frame.pixels);
			}) : canvas.getContext('webgpu')!;
			context.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const analysisTextures: GPUTexture[] = [];
			const analysisContext = (width: number, height: number): PreviewCanvasContext => {
				const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
				analysisTextures.push(texture);
				return { canvas: new OffscreenCanvas(width, height), configure() {}, unconfigure() {}, getCurrentTexture: () => texture };
			};
			const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context, enableWaveformAndHistogram: true,
				histogramGpuContext: analysisContext(256, 150), waveformHorizontalGpuContext: analysisContext(512, 256), waveformVerticalGpuContext: analysisContext(256, 512) });
			const buffers: GPUBuffer[] = [];

			async function render(ev: number) {
				renderer.previewExposure = ev;
				const frame = renderer.tryReserveCpuPreviewFrame();
				const encoder = device.createCommandEncoder();
				renderer.renderToCanvas(source, encoder);
				const textures = mode === 'gpu' ? [context.getCurrentTexture(), ...analysisTextures] : analysisTextures;
				const readbacks = textures.map(texture => {
					const bytesPerRow = Math.ceil(texture.width * 4 / 256) * 256;
					const buffer = device.createBuffer({ size: bytesPerRow * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
					buffers.push(buffer);
					encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [texture.width, texture.height]);
					return { buffer, texture, bytesPerRow };
				});
				frame?.prepareReadback(encoder);
				device.queue.submit([encoder.finish()]);
				await frame?.complete();
				const output = await Promise.all(readbacks.map(async ({ buffer, texture, bytesPerRow }) => {
					await buffer.mapAsync(GPUMapMode.READ);
					const rgba = new Uint8ClampedArray(texture.width * texture.height * 4);
					copyPreviewPixels(new Uint8Array(buffer.getMappedRange()), rgba, texture.width, texture.height, bytesPerRow, format === 'bgra8unorm');
					buffer.unmap();
					return new Uint8Array(rgba);
				}));
				if (mode === 'cpu') output.unshift(cpuPixels!);
				return output;
			}

			try {
				const baseline = await render(0);
				for (const ev of [0, 2, -4, 20, -20]) {
					const output = await render(ev);
					for (let pixel = 0; pixel < 4; pixel++) {
						const color = straightPixels[pixel];
						for (let channel = 0; channel < 4; channel++) {
							const expected = channel === 3 ? color[3] : color[3] === 0 ? 0 : Math.min(1, expose(color[channel], ev));
							if (Math.abs(output[0][pixel * 4 + channel] - expected * 255) > 3) throw new Error(`${mode} ${ev} EV pixel ${pixel} channel ${channel}: ${output[0][pixel * 4 + channel]} != ${expected * 255}`);
						}
					}
					for (let index = 1; index < output.length; index++) {
						if (output[index].some((value, offset) => value !== baseline[index][offset])) throw new Error(`${mode}: exposure changed analysis output ${index}`);
					}
					checks.push(`${mode} ${ev} EV color, alpha and analysis`);
				}
				// 【クリッピング警告は補正前の判定と警告色を保つ】
				// 露出で白飛びを暗く表示しても、元の出力の警告が消えたり暗くなったりしてはならない。
				device.queue.writeTexture({ texture: source }, new Uint16Array([0x4000, 0x4000, 0x4000, 0x3c00, ...new Array(12).fill(0)]), { bytesPerRow: 16 }, [2, 2]);
				renderer.highlightClipping = true;
				const warned = (await render(-4))[0];
				if ([255, 0, 255, 255].some((value, index) => warned[index] !== value)) throw new Error(`${mode}: clipping warning changed`);
				checks.push(`${mode} unexposed clipping warning`);
				// 【背景との合成はsRGB化より前に行い、alpha=0の発光も表示する】
				// 透明Canvasの上でブラウザーに合成させると、線形光の合成と一致しない。
				// 不透明出力は半透明の光量をそのまま使い、発光RGBを消してはならない。
				renderer.highlightClipping = false;
				renderer.previewBackground = 'black';
				device.queue.writeTexture({ texture: source }, new Uint16Array([0x3400, 0x3000, 0x2800, 0x3800, ...new Array(12).fill(0)]), { bytesPerRow: 16 }, [2, 2]);
				const composed = (await render(0))[0];
				for (const [channel, value] of [0.25, 0.125, 0.03125, 1].entries()) {
					const expected = channel === 3 ? 255 : expose(value, 0) * 255;
					if (Math.abs(composed[channel] - expected) > 2) throw new Error(`${mode}: background was composed after sRGB encoding`);
				}
				device.queue.writeTexture({ texture: source }, new Uint16Array([0x3800, 0x3400, 0, 0, ...new Array(12).fill(0)]), { bytesPerRow: 16 }, [2, 2]);
				const emitted = (await render(-1))[0];
				if (Math.abs(emitted[0] - expose(0.5, -1) * 255) > 2 || emitted[3] !== 255) throw new Error(`${mode}: zero-alpha emission was discarded`);
				checks.push(`${mode} linear background and zero-alpha emission`);
			} finally {
				renderer.destroy();
				context.unconfigure();
				for (const texture of analysisTextures) texture.destroy();
				for (const buffer of buffers) buffer.destroy();
			}
		}
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally { source.destroy(); device.destroy(); }
}
