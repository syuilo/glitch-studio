import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { CpuPreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import { linearChannelToSrgb } from '@gs/shared/color-space.ts';
import { getPreviewWaveformViewportRanges } from '@gs/glitch-studio_shared/preview-waveform-viewport.ts';
import type { PreviewWaveformViewports } from '@gs/glitch-studio_shared/preview-waveform-viewport.ts';
import type { PreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import type { PreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';

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
			const outputs: GPUTexture[] = [];
			const pixels: Uint8Array[] = [];
			function context(width: number, height: number): PreviewCanvasContext {
				const index = outputs.length;
				const output = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
				outputs.push(output);
				const canvas = new OffscreenCanvas(width, height);
				if (!cpu) return { canvas, configure() {}, unconfigure() {}, getCurrentTexture: () => output };
				const context = new CpuPreviewCanvasContext(canvas, frame => { pixels[index] = new Uint8Array(frame.pixels).slice(); context.recyclePixels(frame.frameId, frame.pixels); });
				context.configure({ device, format, alphaMode: 'opaque' });
				return context;
			}
			const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context(1, 1), enableWaveformAndHistogram: true,
				histogramGpuContext: context(256, 150), waveformHorizontalGpuContext: context(128, 256), waveformVerticalGpuContext: context(256, 128) });
			renderer.analysisTarget = 'vectorX';
			renderer.analysisValueScale = 'linear';
			const source = device.createTexture({ size: [1024, 1024], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			const values = [0.5 - 1 / 64 - 1 / 128, 0.5 - 1 / 64 + 1 / 128, 0.5 + 1 / 64 - 1 / 128, 0.5 + 1 / 64 + 1 / 128];
			const bits = values.map(float32ToFloat16Bits);
			const data = new Uint16Array(1024 * 1024 * 4);
			for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
				data[(y * 1024 + x) * 4] = bits[(x % 2) * 2 + y % 2];
				data[(y * 1024 + x) * 4 + 3] = 0x3c00;
			}
			device.queue.writeTexture({ texture: source }, data, { bytesPerRow: 1024 * 8 }, [1024, 1024]);
			async function render(texture: GPUTexture) {
				const frame = renderer.tryReserveCpuPreviewFrame();
				const encoder = device.createCommandEncoder();
				renderer.renderToCanvas(texture, encoder);
				frame?.prepareReadback(encoder);
				device.queue.submit([encoder.finish()]);
				await (frame?.complete() ?? device.queue.onSubmittedWorkDone());
			}
			async function read(index: number) {
				if (cpu) return pixels[index];
				const output = outputs[index];
				const buffer = device.createBuffer({ size: output.width * output.height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
				try {
					const encoder = device.createCommandEncoder();
					encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: output.width * 4 }, [output.width, output.height]);
					device.queue.submit([encoder.finish()]);
					await buffer.mapAsync(GPUMapMode.READ);
					return new Uint8Array(buffer.getMappedRange()).slice();
				} finally { buffer.destroy(); }
			}
			function red(image: Uint8Array, vertical: boolean, position: number, level: number) { return image[(vertical ? position * 256 + level : (255 - level) * 128 + position) * 4 + (!cpu && format === 'bgra8unorm' ? 2 : 0)]; }
			const zoomed: PreviewWaveformViewports = { horizontal: { x: 0.4375, y: 0.4375, width: 0.125, height: 0.125 }, vertical: { x: 0.4375, y: 0.4375, width: 0.125, height: 0.125 } };
			async function checkDetails(viewports: PreviewWaveformViewports | null, range = { minimum: 0, maximum: 1 }, transform: (value: number) => number = value => value) {
				for (const [direction, vertical, index] of [['horizontal', false, 2], ['vertical', true, 3]] as const) {
					const image = await read(index);
					const window = viewports == null ? { minimum: 0, maximum: 1 } : getPreviewWaveformViewportRanges(direction, viewports[direction]).valueWindow;
					for (const position of [0, 1]) for (const [valueIndex, value] of values.entries()) {
						const normalized = (transform(value) - range.minimum) / (range.maximum - range.minimum);
						const level = Math.round((normalized - window.minimum) / (window.maximum - window.minimum) * 255);
						const wanted = viewports == null || (vertical ? valueIndex % 2 === position : Math.floor(valueIndex / 2) === position);
						const peak = Math.max(...[-1, 0, 1].map(offset => red(image, vertical, position, level + offset)));
						// fragmentのUV補間の丸めで隣の列がごく薄く混ざる場合がある。白い信号とのコントラストで判定する。
						if (wanted ? peak < 128 : peak > 16) throw new Error(`${cpu ? 'CPU' : 'GPU'} ${direction} zoom=${viewports != null} detail ${position}, ${valueIndex}: peak=${peak}, expected signal=${wanted}`);
					}
				}
			}
			try {
				await render(source);
				await checkDetails(null);
				renderer.analysisWaveformViewports = zoomed;
				await renderer.refreshImageAnalysis();
				await checkDetails(zoomed);
				checks.push(`${cpu ? 'CPU' : 'GPU'} normal zoom resolves native alternating pixels`);
				renderer.analysisWaveformViewports = null;
				await renderer.refreshImageAnalysis();
				const settings: PreviewImageAnalysisSettings = { target: 'vectorX', imageSource: 'original', imageAdjustments: { exposure: 0, srgbProof: false, gamutCompression: { mode: 'none', customAmount: 0.5 } }, valueScale: 'linear', valueRange: { minimum: 0, maximum: 1 }, waveformCanvasSizes: null, waveformViewports: null, histogramViewport: null };
				await renderer.setHighResolutionImageAnalysis(true, settings);
				source.destroy();
				renderer.clear();
				await renderer.setHighResolutionImageAnalysis(true, { ...settings, waveformViewports: zoomed });
				await checkDetails(zoomed);
				checks.push(`${cpu ? 'CPU' : 'GPU'} HOLD zoom resolves native pixels after source destruction`);
				await renderer.setHighResolutionImageAnalysis(true, { ...settings, valueRange: { minimum: 1, maximum: 0 }, waveformViewports: zoomed });
				await checkDetails(zoomed, { minimum: 1, maximum: 0 });
				checks.push(`${cpu ? 'CPU' : 'GPU'} reversed ranges retain the zoomed value direction`);
				const srgbViews: PreviewWaveformViewports = { horizontal: { ...zoomed.horizontal, y: 0.2, height: 0.1 }, vertical: { ...zoomed.vertical, x: 0.7, width: 0.1 } };
				await renderer.setHighResolutionImageAnalysis(true, { ...settings, target: 'rgb', valueScale: 'srgb', waveformViewports: srgbViews });
				await checkDetails(srgbViews, settings.valueRange, linearChannelToSrgb);
				checks.push(`${cpu ? 'CPU' : 'GPU'} sRGB zoom uses encoded values without changing the base range`);
				const evViews: PreviewWaveformViewports = { horizontal: { ...zoomed.horizontal, y: 0.41875, height: 0.0125 }, vertical: { ...zoomed.vertical, x: 0.56875, width: 0.0125 } };
				await renderer.setHighResolutionImageAnalysis(true, { ...settings, target: 'rgb', valueScale: 'ev', valueRange: { minimum: -10, maximum: 10 }, waveformViewports: evViews });
				await checkDetails(evViews, { minimum: -10, maximum: 10 }, value => Math.log2(value / 0.18));
				checks.push(`${cpu ? 'CPU' : 'GPU'} EV zoom uses exposure values without applying the transform twice`);
				const clipped: PreviewWaveformViewports = { horizontal: { ...zoomed.horizontal, y: 0.375 }, vertical: { ...zoomed.vertical, x: 0.5 } };
				await renderer.setHighResolutionImageAnalysis(true, { ...settings, waveformViewports: clipped });
				const horizontal = await read(2);
				const vertical = await read(3);
				if (Array.from({ length: 256 }, (_, level) => red(horizontal, false, 0, level)).some(value => value > 16)) throw new Error('Values outside the zoom window formed a false edge');
				if ([0, 1].some(position => red(vertical, true, position, 0) > 16 || red(vertical, true, position, 255) > 16)) throw new Error('Vertical value clipping formed a false edge');
				checks.push(`${cpu ? 'CPU' : 'GPU'} zoom clips offscreen values instead of accumulating them at its edges`);
				await renderer.setHighResolutionImageAnalysis(true, settings);
				await checkDetails(null);
				checks.push(`${cpu ? 'CPU' : 'GPU'} reset restores the full held waveform`);
				await renderer.setHighResolutionImageAnalysis(false, settings);
				const single = device.createTexture({ size: [1, 1], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
				try {
					device.queue.writeTexture({ texture: single }, new Uint16Array([0x4000]), { bytesPerRow: 2 }, [1, 1]); // 2
					renderer.analysisWaveformViewports = { horizontal: { x: 0, y: 0, width: 0.1, height: 0.1 }, vertical: { x: 0.9, y: 0.9, width: 0.1, height: 0.1 } };
					await render(single);
					if (red(await read(2), false, 0, 255) === 0 || red(await read(3), true, 0, 255) === 0) throw new Error('A partial pixel cell or original range boundary disappeared during zoom');
					checks.push(`${cpu ? 'CPU' : 'GPU'} zoom preserves partial source cells and original out-of-range edge counts`);
				} finally { single.destroy(); }
			} finally { source.destroy(); renderer.destroy(); for (const output of outputs) output.destroy(); }
		}
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally { device.destroy(); }
}
