import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { createCanvasOutputConfigurator, createGpuPreviewCanvasOutputSettings, createSrgbCanvasOutputSettings } from '../../src/canvas-output.ts';
import { CpuPreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import { linearChannelToSrgb, linearSrgbToOklch, oklchToLinearSrgb } from '@gs/shared/color-space.ts';

const REDS = [[1, 0, 0], [1.2249401763, -0.0420569547, -0.0196375546]];
const P3_REDS = [[0.8224619687, 0.0331941989, 0.0170826307], [1, 0, 0]];

function assertPixels(name: string, actual: ArrayLike<number>, expected: number[], tolerance = 0.006) {
	for (const [index, value] of expected.entries()) {
		if (!Number.isFinite(actual[index]) || Math.abs(actual[index] - value) > tolerance) {
			throw new Error(`${name}, component ${index}: ${actual[index]} != ${value}`);
		}
	}
}

function checkFloatCanvas(canvas: OffscreenCanvas, colorSpace: PredefinedColorSpace, colors: number[][], alpha: number) {
	const context = new OffscreenCanvas(2, 1).getContext('2d', { colorSpace, colorType: 'float16' })!;
	context.drawImage(canvas, 0, 0);
	// getImageDataは未乗算RGBを返す。乗算済みのGPU出力が二重に暗くならないことも確認する。
	const pixels = context.getImageData(0, 0, 2, 1, { colorSpace, pixelFormat: 'rgba-float16' }).data;
	assertPixels(`${colorSpace}, alpha ${alpha}`, pixels, colors.flatMap(rgb => [...rgb.map(linearChannelToSrgb), alpha]));
}

async function render(canvas: OffscreenCanvas) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const context = canvas.getContext('webgpu')!;
	const output = createGpuPreviewCanvasOutputSettings();
	const configure = createCanvasOutputConfigurator(device, context, output);
	const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context, canvasOutput: output, enableWaveformAndHistogram: false });
	const source = device.createTexture({ size: [2, 1], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
	const checks: string[] = [];
	const draw = (colors: number[][], alpha: number, background: 'black' | null, exposure = 0) => {
		device.queue.writeTexture({ texture: source }, new Float16Array(colors.flatMap(rgb => [...rgb.map(value => value * alpha), alpha])), { bytesPerRow: 16 }, [2, 1]);
		renderer.previewBackground = background;
		renderer.previewExposure = exposure;
		configure(background == null ? 'premultiplied' : 'opaque');
		const encoder = device.createCommandEncoder();
		renderer.renderToCanvas(source, encoder);
		device.queue.submit([encoder.finish()]);
	};
	try {
		// 【実際の表示shaderはP3の赤をsRGBの赤へ潰さず、出力の色空間を正しくタグ付けする】
		// float値の保持だけでなく別原色のCanvasへの変換も通し、encodeの重複や原色の誤指定を検出する。
		draw(REDS, 1, 'black');
		checkFloatCanvas(canvas, 'srgb', REDS, 1);
		checkFloatCanvas(canvas, 'display-p3', P3_REDS, 1);
		const configuration = context.getConfiguration()!;
		if (configuration.format !== 'rgba16float' || configuration.colorSpace !== 'srgb' || configuration.toneMapping?.mode !== 'standard') {
			throw new Error('GPU preview configuration changed its output contract');
		}
		checks.push('GPU preview preserves wide gamut and converts to Display P3');

		// 【広色域でも中間調・露出・半透明をlinearで処理する】
		// 不透明の原色だけでは、伝達関数の二重適用やalphaの誤った乗除算を検出できない。
		draw([[0.18, 0.18, 0.18], [0.5, 0.5, 0.5]], 1, 'black');
		checkFloatCanvas(canvas, 'srgb', [[0.18, 0.18, 0.18], [0.5, 0.5, 0.5]], 1);
		draw(REDS, 1, 'black', -1);
		checkFloatCanvas(canvas, 'srgb', REDS.map(rgb => rgb.map(value => value / 2)), 1);
		draw(REDS, 0.5, null);
		checkFloatCanvas(canvas, 'srgb', REDS, 0.5);
		// P3変換は実プレビューと同じ、linearで背景へ合成済みの不透明出力で検証する。
		// 半透明自体のencodeとalphaは、同じsRGB空間へのfloatコピーで確認する。
		draw(REDS, 0.5, 'black');
		checkFloatCanvas(canvas, 'srgb', REDS.map(rgb => rgb.map(value => value / 2)), 1);
		checkFloatCanvas(canvas, 'display-p3', P3_REDS.map(rgb => rgb.map(value => value / 2)), 1);
		checks.push('GPU preview preserves gray, exposure and premultiplied alpha');

		// 【色域圧縮はfloat出力を選んでも従来の表示変換として作用する】
		// 出力のclampだけを外し、利用者の圧縮設定が無効にならないことを確認する。
		renderer.previewGamutCompression = { mode: 'custom', customAmount: 0.5 };
		draw(REDS, 1, 'black');
		const compressed = REDS.map(rgb => {
			const [lightness, chroma, hue] = linearSrgbToOklch(rgb);
			return oklchToLinearSrgb([lightness, chroma / 2, hue]).slice(0, 3);
		});
		checkFloatCanvas(canvas, 'srgb', compressed, 1);
		checks.push('GPU preview retains gamut compression');

		// 【CPU表示とSDR書き出しは広色域プレビューの設定を引き継がない】
		// 同じ作業画像が8bit sRGBの赤へ制限されることを、CPU読み戻しと実Canvasの両方で確認する。
		for (const mode of ['cpu', 'export'] as const) {
			const outputCanvas = new OffscreenCanvas(2, 1);
			let cpuPixels: Uint8Array | null = null;
			const outputContext = mode === 'cpu' ? new CpuPreviewCanvasContext(outputCanvas, frame => { cpuPixels = new Uint8Array(frame.pixels); }) : outputCanvas.getContext('webgpu')!;
			const srgbOutput = createSrgbCanvasOutputSettings();
			createCanvasOutputConfigurator(device, outputContext, srgbOutput)('opaque');
			const srgbRenderer = new CanvasRenderer({ gpuDevice: device, gpuContext: outputContext, canvasOutput: srgbOutput, enableWaveformAndHistogram: false });
			try {
				srgbRenderer.previewBackground = 'black';
				const frame = srgbRenderer.tryReserveCpuPreviewFrame();
				const encoder = device.createCommandEncoder();
				srgbRenderer.renderToCanvas(source, encoder);
				frame?.prepareReadback(encoder);
				device.queue.submit([encoder.finish()]);
				if (mode === 'cpu') {
					await frame!.complete();
					assertPixels(mode, cpuPixels!, [255, 0, 0, 255, 255, 0, 0, 255], 1);
				} else {
					const snapshot = new OffscreenCanvas(2, 1).getContext('2d')!;
					snapshot.drawImage(outputCanvas, 0, 0);
					assertPixels(mode, snapshot.getImageData(0, 0, 2, 1).data, [255, 0, 0, 255, 255, 0, 0, 255], 1);
				}
				checks.push(`${mode} output remains 8-bit sRGB`);
			} finally { srgbRenderer.destroy(); outputContext.unconfigure(); }
		}
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally { renderer.destroy(); source.destroy(); context.unconfigure(); device.destroy(); }
}

// UIからWorkerへ転送されたOffscreenCanvasを使い、実際のプレビューと同じ所有関係で検証する。
if (typeof document === 'undefined') {
	self.onmessage = async (event: MessageEvent<OffscreenCanvas>) => {
		try { self.postMessage({ checks: await render(event.data) }); }
		catch (error) { self.postMessage({ error: String(error) }); }
	};
}

export async function run() {
	const worker = new Worker('/probe.js', { type: 'module' });
	const canvas = new OffscreenCanvas(2, 1);
	try {
		const checks = await new Promise<string[]>((resolve, reject) => {
			worker.onmessage = ({ data }) => {
				if (data.error != null) reject(new Error(data.error));
				else resolve(data.checks);
			};
			worker.onerror = event => reject(new Error(event.message));
			worker.postMessage(canvas, [canvas]);
		});
		return { runtime: navigator.userAgent, checks };
	} finally { worker.terminate(); }
}
