import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { createGpuPreviewCanvasOutputSettings, createSrgbCanvasOutputSettings } from '../../src/canvas-output.ts';
import { CpuPreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import type { PreviewCanvasContext } from '../../src/preview-canvas-context.ts';

const SIZE = 12;
const YELLOW = [1, 1, 0, 1];

function assertPixel(name: string, pixels: Float32Array, x: number, expected: ArrayLike<number>) {
	for (let channel = 0; channel < 4; channel++) {
		const actual = pixels[x * 4 + channel];
		if (!Number.isFinite(actual) || Math.abs(actual - expected[channel]) > 0.006) {
			throw new Error(`${name}, pixel ${x}, channel ${channel}: ${actual} != ${expected[channel]}`);
		}
	}
}

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const checks: string[] = [];
	const source = device.createTexture({ size: [SIZE, SIZE], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	try {
		for (const mode of ['gpu', 'cpu'] as const) {
			const canvas = new OffscreenCanvas(SIZE, SIZE);
			const output = mode === 'gpu' ? createGpuPreviewCanvasOutputSettings() : createSrgbCanvasOutputSettings();
			let cpuPixels: Float32Array | null = null;
			const context: PreviewCanvasContext = mode === 'cpu' ? new CpuPreviewCanvasContext(canvas, frame => {
				cpuPixels = Float32Array.from(new Uint8Array(frame.pixels), value => value / 255);
				(context as CpuPreviewCanvasContext).recyclePixels(frame.frameId, frame.pixels);
			}) : canvas.getContext('webgpu')!;
			context.configure({ device, format: output.format, colorSpace: output.colorSpace, alphaMode: 'premultiplied',
				toneMapping: { mode: 'standard' }, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context, canvasOutput: output, enableWaveformAndHistogram: false });
			renderer.previewBackground = 'black';
			const bytesPerRow = 256;
			const readback = device.createBuffer({ size: bytesPerRow * SIZE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

			function writeSource(premultiplied: number[]) {
				device.queue.writeTexture({ texture: source }, new Float16Array(Array.from({ length: SIZE * SIZE }, () => premultiplied).flat()),
					{ bytesPerRow: SIZE * 8 }, [SIZE, SIZE]);
			}

			async function render(enabled: boolean) {
				renderer.previewGamutWarning = { ...renderer.previewGamutWarning, enabled };
				const frame = renderer.tryReserveCpuPreviewFrame();
				const encoder = device.createCommandEncoder();
				renderer.renderToCanvas(source, encoder);
				if (mode === 'gpu') encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() }, { buffer: readback, bytesPerRow }, [SIZE, SIZE]);
				frame?.prepareReadback(encoder);
				device.queue.submit([encoder.finish()]);
				await frame?.complete();
				if (mode === 'cpu') {
					if (cpuPixels == null) throw new Error('CPU preview did not present pixels');
					return cpuPixels;
				}
				await readback.mapAsync(GPUMapMode.READ);
				const mapped = new Float16Array(readback.getMappedRange());
				const pixels = new Float32Array(SIZE * SIZE * 4);
				for (let y = 0; y < SIZE; y++) pixels.set(mapped.subarray(y * bytesPerRow / 2, y * bytesPerRow / 2 + SIZE * 4), y * SIZE * 4);
				readback.unmap();
				return pixels;
			}

			async function check(name: string, color: number[], warning: boolean) {
				writeSource(color);
				const baseline = await render(false);
				const highlighted = await render(true);
				if (warning) {
					assertPixel(`${mode}: ${name} stripe`, highlighted, 0, YELLOW);
					assertPixel(`${mode}: ${name} gap`, highlighted, 6, baseline.subarray(24, 28));
				} else if (highlighted.some((value, index) => value !== baseline[index])) {
					throw new Error(`${mode}: ${name} changed an in-gamut image`);
				}
				checks.push(`${mode}: ${name}`);
			}

			try {
				// 【選択色域の境界とHALFへ丸めた広色域原色を正しく区別する】
				// sRGBだけでの判定や行列の転置忘れ、境界の量子化を範囲外とする誤警告を検出する。
				for (const referenceGamut of ['srgb', 'displayP3', 'rec2020', 'adobeRgb'] as const) {
					renderer.previewGamutWarning = { enabled: true, referenceGamut };
					await check(`${referenceGamut} black`, [0, 0, 0, 1], false);
					await check(`${referenceGamut} white`, [1, 1, 1, 1], false);
					await check(`${referenceGamut} sRGB red`, [1, 0, 0, 1], false);
					// 色域の大きさだけで包含を仮定しない。P3の赤はRec.2020でもBが約-0.0012になる。
					await check(`${referenceGamut} P3 red`, [1.2249401763, -0.0420569547, -0.0196375546, 1], referenceGamut !== 'displayP3');
					await check(`${referenceGamut} Rec.2020 red`, [1.6604910021, -0.1245504745, -0.0181507634, 1], referenceGamut !== 'rec2020');
					await check(`${referenceGamut} Adobe RGB green`, [-0.398355744, 1, -0.0429289893, 1], referenceGamut === 'srgb' || referenceGamut === 'displayP3');
				}
				renderer.previewGamutWarning = { enabled: true, referenceGamut: 'srgb' };

				// 【一成分だけの超過も検出し、半透明は未乗算色、alpha=0は独立した発光として扱う】
				// 元の乗算済みRGBでの0〜1判定や、alpha=0の一律除外では正しく検出できない。
				await check('one component above one', [2, 0.25, 0.125, 1], true);
				await check('one HALF step above one', [1.0009765625, 0.25, 0.125, 1], true);
				await check('one negative component', [-0.125, 0.25, 0.125, 1], true);
				await check('negative dark color', [-0.000000059604644775390625, 0, 0, 1], true);
				await check('HDR gray', [2, 2, 2, 1], true);
				await check('translucent out-of-gamut color', [0.75, 0.125, 0.0625, 0.5], true);
				await check('translucent in-gamut color', [0.25, 0.125, 0.0625, 0.5], false);
				await check('transparent black', [0, 0, 0, 0], false);
				await check('zero-alpha emission', [2, 0.25, 0.125, 0], true);

				// 【表示補正と背景を変えても、元画像の判定と不透明な警告色を維持する】
				// sRGB確認のclamp後を調べたり警告色へ露出を適用すると、この画素の斜線が消える。
				writeSource([2, 0.25, 0.125, 0]);
				renderer.previewExposure = -4;
				renderer.previewGamutCompression = { mode: 'custom', customAmount: 1 };
				for (const background of [null, 'black', 'checker'] as const) {
					renderer.previewBackground = background;
					for (const proof of [false, true]) {
						renderer.previewSrgbProof = proof;
						assertPixel(`${mode}: display transforms`, await render(true), 0, YELLOW);
						checks.push(`${mode}: ${background} background, proof ${proof}`);
					}
				}
				renderer.previewExposure = 0;
				renderer.previewSrgbProof = false;
				renderer.previewGamutCompression = { mode: 'none', customAmount: 0.5 };
				renderer.previewBackground = 'black';

				// 【黒・白の既存警告は斜線より優先し、それ以外の範囲外は両方オンでも検出する】
				// 警告の適用順を入れ替えて既存の診断色を上書きしないことを確認する。
				renderer.highlightClipping = true;
				for (const [color, expected] of [[[2, 2, 2, 1], [1, 0, 1, 1]], [[-0.125, -0.125, -0.125, 1], [0, 1, 0, 1]]]) {
					writeSource(color);
					const highlighted = await render(true);
					assertPixel(`${mode}: clipping priority stripe`, highlighted, 0, expected);
					assertPixel(`${mode}: clipping priority gap`, highlighted, 6, expected);
					checks.push(`${mode}: clipping priority ${expected}`);
				}
				await check('single-channel warning alongside clipping', [2, 0.25, 0.125, 1], true);
			} finally {
				readback.destroy();
				renderer.destroy();
				context.unconfigure();
			}
		}
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally {
		source.destroy();
		device.destroy();
	}
}
