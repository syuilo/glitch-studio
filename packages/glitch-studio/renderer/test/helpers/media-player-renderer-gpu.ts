import { MediaPlayerRenderer } from '../../src/media-player-renderer.ts';
import type { MediaPlayerRendererOptions } from '../../src/media-player-renderer.ts';
import type { CpuPreviewFrame } from '../../src/preview-canvas-context.ts';

export async function run() {
	const canvases = {
		canvas: new OffscreenCanvas(1, 1),
		histogramCanvas: new OffscreenCanvas(256, 150),
		waveformHorizontalCanvas: new OffscreenCanvas(1, 1),
		waveformVerticalCanvas: new OffscreenCanvas(1, 1),
	};
	const preview: MediaPlayerRendererOptions['preview'] = {
		highlightClipping: false,
		previewWarningImageSource: 'original',
		previewGamutWarning: { enabled: false, referenceGamut: 'srgb', bounds: 'unit' },
		previewExposure: 0,
		previewSrgbProof: false,
		previewGamutCompression: { mode: 'none', customAmount: 0.5 },
		previewBackground: 'black',
		analysisTarget: 'rgb',
		analysisImageSource: 'original',
		analysisPaused: false,
		analysisValueScale: 'srgb',
		analysisValueRange: { minimum: 0, maximum: 1 },
		analysisWaveformCanvasSizes: { horizontal: { width: 32, height: 16 }, vertical: { width: 16, height: 32 } },
		analysisWaveformViewports: null,
		analysisHistogramViewport: null,
	};
	const source = new OffscreenCanvas(16, 8);
	const context = source.getContext('2d')!;
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, source.width, source.height);
	const image = await source.convertToBlob();
	const passed: string[] = [];
	for (const kind of ['image', 'video'] as const) {
		const renderer = await MediaPlayerRenderer.create({ canvases, displayMode: 'cpu', analysisEnabled: true, preview });
		const frames = new Map<CpuPreviewFrame['target'], CpuPreviewFrame>();
		const errors: string[] = [];
		renderer.on('ev', event => {
			if (event.type === 'renderError') errors.push(event.ctx.message);
			else {
				const frame = event.ctx;
				frames.set(frame.target, { ...frame, pixels: frame.pixels.slice(0) });
				renderer.recycleCpuPreviewPixels(frame.target, frame.frameId, frame.pixels);
			}
		});
		try {
			if (kind === 'image') {
				const resolution = await renderer.showImage(image);
				if (resolution.width !== 16 || resolution.height !== 8) throw new Error('Unexpected image resolution');
			} else {
				context.fillStyle = '#0000ff';
				context.fillRect(0, 0, source.width, source.height);
				await renderer.showVideoFrame(new VideoFrame(source, { timestamp: 0 }), { width: 16, height: 8 });
			}
			if (errors.length > 0) throw new Error(errors.join('\n'));
			const previewFrame = frames.get('canvas');
			if (previewFrame == null || previewFrame.width !== 16 || previewFrame.height !== 8) throw new Error('Preview resolution mismatch');
			const [red, green, blue, alpha] = new Uint8Array(previewFrame.pixels, 0, 4);
			if (green !== 0 || alpha !== 255 || (kind === 'image' ? red < 254 || blue !== 0 : blue < 254 || red !== 0)) {
				throw new Error(`Unexpected ${kind} preview pixel ${red},${green},${blue},${alpha}`);
			}
			passed.push(kind);
			for (const target of ['histogramCanvas', 'waveformHorizontalCanvas', 'waveformVerticalCanvas'] as const) {
				const frame = frames.get(target);
				if (frame == null || !new Uint8Array(frame.pixels).some((value, index) => index % 4 < 3 && value > 0)) {
					throw new Error(`Missing ${kind} analysis for ${target}`);
				}
				passed.push(`${kind}: ${target}`);
			}
		} finally {
			renderer.destroy();
		}
	}
	return passed;
}
