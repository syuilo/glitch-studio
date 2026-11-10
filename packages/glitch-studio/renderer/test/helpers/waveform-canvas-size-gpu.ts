import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { CpuPreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import type { CpuPreviewPixels, PreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import type { PreviewImageAnalysisSettings, PreviewWaveformCanvasSizes } from '@gs/glitch-studio_shared/preview-image-analysis.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const format = navigator.gpu.getPreferredCanvasFormat();
	const checks: string[] = [];
	try {
		for (const cpu of [false, true]) {
			const outputs: PreviewCanvasContext[] = [];
			const textures = new Set<GPUTexture>();
			const frames: CpuPreviewPixels[] = [];
			let mainFrames = 0;
			function context(width: number, height: number): PreviewCanvasContext {
				const index = outputs.length;
				const canvas = new OffscreenCanvas(width, height);
				let texture: GPUTexture | null = null;
				const result = cpu ? new CpuPreviewCanvasContext(canvas, frame => {
					if (index === 0) mainFrames++;
					frames[index] = { ...frame, pixels: frame.pixels.slice(0) };
					(result as CpuPreviewCanvasContext).recyclePixels(frame.frameId, frame.pixels);
				}) : { canvas, configure() {}, unconfigure() {}, getCurrentTexture() {
					if (index === 0) mainFrames++;
					if (texture == null || texture.width !== canvas.width || texture.height !== canvas.height) {
						texture = device.createTexture({ size: [canvas.width, canvas.height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
						textures.add(texture);
					}
					return texture;
				} };
				result.configure({ device, format, alphaMode: 'opaque' });
				outputs.push(result);
				return result;
			}
			const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context(1, 1), enableWaveformAndHistogram: true,
				histogramGpuContext: context(256, 150), waveformHorizontalGpuContext: context(1, 1), waveformVerticalGpuContext: context(1, 1) });
			renderer.analysisTarget = 'vectorX';
			renderer.analysisValueScale = 'linear';
			const source = device.createTexture({ size: [1536, 768], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			const values = new Uint16Array(1536 * 768).fill(0x3400); // 0.25
			device.queue.writeTexture({ texture: source }, values, { bytesPerRow: 1536 * 2 }, [1536, 768]);
			async function read(index: number): Promise<CpuPreviewPixels> {
				if (cpu) return frames[index];
				const texture = outputs[index].getCurrentTexture();
				const bytesPerRow = Math.ceil(texture.width * 4 / 256) * 256;
				const buffer = device.createBuffer({ size: bytesPerRow * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
				try {
					const encoder = device.createCommandEncoder();
					encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [texture.width, texture.height]);
					device.queue.submit([encoder.finish()]);
					await buffer.mapAsync(GPUMapMode.READ);
					const packed = new Uint8Array(texture.width * texture.height * 4);
					const padded = new Uint8Array(buffer.getMappedRange());
					for (let row = 0; row < texture.height; row++) packed.set(padded.subarray(row * bytesPerRow, row * bytesPerRow + texture.width * 4), row * texture.width * 4);
					return { frameId: 0, width: texture.width, height: texture.height, pixels: packed.buffer };
				} finally { buffer.destroy(); }
			}
			async function check(sizes: PreviewWaveformCanvasSizes, value: number) {
				for (const [index, vertical] of [false, true].entries()) {
					const expected = vertical ? sizes.vertical : sizes.horizontal;
					const actual = await read(index + 2);
					if (actual.width !== expected.width || actual.height !== expected.height) throw new Error('Waveform retained a fixed Canvas resolution');
					const pixels = new Uint8Array(actual.pixels);
					const positions = vertical ? actual.height : actual.width;
					const levels = vertical ? actual.width : actual.height;
					for (const position of [0, Math.floor(positions / 2), positions - 1]) {
						let peak = -1;
						let maximum = 0;
						for (let level = 0; level < levels; level++) {
							const offset = (vertical ? position * actual.width + level : level * actual.width + position) * 4;
							if (pixels[offset] > maximum) { maximum = pixels[offset]; peak = level; }
						}
						const expectedLevel = (vertical ? value : 1 - value) * (levels - 1);
						if (peak < 0 || Math.abs(peak - expectedLevel) > Math.ceil(levels / 255)) throw new Error(`Resized waveform has an empty column or stale value bins: ${peak}, expected ${expectedLevel}`);
					}
				}
			}
			try {
				const initial = { horizontal: { width: 750, height: 350 }, vertical: { width: 310, height: 670 } };
				renderer.analysisWaveformCanvasSizes = initial;
				const frame = renderer.tryReserveCpuPreviewFrame();
				const encoder = device.createCommandEncoder();
				renderer.renderToCanvas(source, encoder);
				frame?.prepareReadback(encoder);
				device.queue.submit([encoder.finish()]);
				await (frame?.complete() ?? device.queue.onSubmittedWorkDone());
				await check(initial, 0.25);
				checks.push(`${cpu ? 'CPU' : 'GPU'} initial Canvas and bins use panel dimensions`);
				const mainBeforeResize = mainFrames;
				const resized = { horizontal: { width: 1250, height: 530 }, vertical: { width: 530, height: 1250 } };
				renderer.analysisWaveformCanvasSizes = resized;
				await renderer.refreshImageAnalysis();
				await check(resized, 0.25);
				if (mainFrames !== mainBeforeResize) throw new Error('Waveform resize redrew the main preview');
				checks.push(`${cpu ? 'CPU' : 'GPU'} resize redraws completed analysis without blank position bins`);
				const settings: PreviewImageAnalysisSettings = { target: 'vectorX', valueScale: 'linear', valueRange: { minimum: 0, maximum: 1 }, waveformCanvasSizes: resized };
				await renderer.setHighResolutionImageAnalysis(true, settings);
				values.fill(0x3a00); // 0.75。リサイズ後も保持した0.25を解析する。
				device.queue.writeTexture({ texture: source }, values, { bytesPerRow: 1536 * 2 }, [1536, 768]);
				source.destroy();
				renderer.clear();
				const heldSize = { horizontal: { width: 960, height: 480 }, vertical: { width: 480, height: 960 } };
				await renderer.setHighResolutionImageAnalysis(true, { ...settings, waveformCanvasSizes: heldSize });
				await check(heldSize, 0.25);
				checks.push(`${cpu ? 'CPU' : 'GPU'} HOLD resizes from the original snapshot after source destruction`);
				await renderer.setHighResolutionImageAnalysis(false, settings);
				checks.push(`${cpu ? 'CPU' : 'GPU'} releases resized held output`);
			} finally {
				source.destroy();
				renderer.destroy();
				for (const texture of textures) texture.destroy();
			}
		}
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally { device.destroy(); }
}
