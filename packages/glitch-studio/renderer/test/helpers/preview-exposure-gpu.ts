import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { CpuPreviewCanvasContext, copyPreviewPixels } from '../../src/preview-canvas-context.ts';
import type { PreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import { getPreviewGamutMaximumChroma } from '../../src/preview-gamut-compression.ts';
import { linearSrgbToOklab, oklabToLinearSrgb, linearChannelToSrgb } from '@gs/shared/color-space.ts';
import type { PreviewGamutCompressionMode } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';

function compressedReference(rgb: number[], mode: PreviewGamutCompressionMode, amount: number) {
	if (mode === 'none' || (mode === 'custom' && amount === 0)) return rgb;
	const [lightness, a, b] = linearSrgbToOklab(rgb);
	let multiplier = 1 - amount;
	if (mode !== 'custom') {
		if (lightness <= 0 || lightness >= 1) return rgb;
		const hue = Math.atan2(b, a);
		multiplier = getPreviewGamutMaximumChroma(lightness, hue, 'srgb') / getPreviewGamutMaximumChroma(lightness, hue, mode);
	}
	return oklabToLinearSrgb([lightness, a * multiplier, b * multiplier]).slice(0, 3);
}

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
				// 【無圧縮は完全一致し、カスタムと各プリセットは明度・色相を保った参照変換へ一致する】
				// LUT補間・uniform・GPU/CPU表示のいずれかを接続し忘れても、実画素で検出する。
				// ACEScgを最初に使い、新規モードだけを選んだ場合もLUTを生成・転送することを確認する。
				for (const gamut of ['acescg', 'custom', 'displayP3', 'rec2020', 'adobeRgb'] as const) {
					renderer.previewGamutCompression = { mode: gamut, customAmount: 0 };
					if (gamut === 'custom') {
						const unchanged = (await render(0))[0];
						if (unchanged.some((value, index) => value !== baseline[0][index])) throw new Error(`${mode}: custom 0% differs from normal`);
						checks.push(`${mode} custom 0% exact bypass`);
					}
					renderer.previewGamutCompression = { mode: gamut, customAmount: 0.5 };
					const output = await render(0);
					for (let pixel = 0; pixel < 3; pixel++) {
						const expected = compressedReference(straightPixels[pixel].slice(0, 3), gamut, 0.5);
						for (let channel = 0; channel < 3; channel++) {
							const encoded = Math.max(0, Math.min(1, linearChannelToSrgb(expected[channel]))) * 255;
							if (Math.abs(output[0][pixel * 4 + channel] - encoded) > 3) throw new Error(`${mode} ${gamut} pixel ${pixel} channel ${channel} differs from reference`);
						}
						if (output[0][pixel * 4 + 3] !== baseline[0][pixel * 4 + 3]) throw new Error(`${mode}: gamut compression changed alpha`);
					}
					for (let index = 1; index < output.length; index++) {
						if (output[index].some((value, offset) => value !== baseline[index][offset])) throw new Error(`${mode}: gamut compression changed analysis`);
					}
					checks.push(`${mode} ${gamut} color, alpha and analysis`);
				}
				// 【sRGBでは同じ赤へ潰れる2色を、P3の圧縮表示で区別する】
				// 元のfloat画像にある負の成分を、表示前に失っていないことを確認する。
				device.queue.writeTexture({ texture: source }, new Float16Array([1, 0, 0, 1, 1.2249401763, -0.0420569547, -0.0196375546, 1,
					0.125, 0.125, 0.125, 1, 0, 0, 0, 0]), { bytesPerRow: 16 }, [2, 2]);
				renderer.previewGamutCompression = { mode: 'none', customAmount: 0.5 };
				const clipped = (await render(0))[0];
				if (clipped.slice(0, 4).some((value, index) => value !== clipped[index + 4])) throw new Error(`${mode}: source reds do not clip identically`);
				renderer.previewGamutCompression = { mode: 'displayP3', customAmount: 0.5 };
				const separated = (await render(0))[0];
				if (separated.slice(0, 3).every((value, index) => Math.abs(value - separated[index + 4]) < 3)) throw new Error(`${mode}: P3 red remained indistinguishable`);
				for (let index = 8; index < 12; index++) if (Math.abs(separated[index] - clipped[index]) > 1) throw new Error(`${mode}: neutral changed`);
				checks.push(`${mode} separates clipped reds and preserves neutrals`);
				// 【各色域の原色も圧縮し、特にRec.2020の青の外側の境界を失わない】
				// float16への取り込み後の値を参照値に使い、LUT格子外・色域の尖った頂点を検証する。
				const gamutPrimaries = {
					displayP3: [[1.2249401763, -0.0420569547, -0.0196375546], [-0.2249401763, 1.0420569547, -0.0786360456], [0, 0, 1.0982736001]],
					rec2020: [[1.6604910021, -0.1245504745, -0.0181507634], [-0.5876411388, 1.1328998971, -0.1005788980], [-0.0728498633, -0.0083494226, 1.1187296614]],
					adobeRgb: [[1.3983557440, 0, 0], [-0.3983557440, 1, -0.0429289893], [0, 0, 1.0429289893]],
					acescg: [[1.7050509927, -0.1302564175, -0.0240033568], [-0.6217921207, 1.1408047366, -0.1289689761], [-0.0832588720, -0.0105483191, 1.1529723329]],
				};
				for (const gamut of ['displayP3', 'rec2020', 'adobeRgb', 'acescg'] as const) {
					const primaries = new Float16Array([...gamutPrimaries[gamut].flatMap(rgb => [...rgb, 1]), 1, 1, 1, 1]);
					device.queue.writeTexture({ texture: source }, primaries, { bytesPerRow: 16 }, [2, 2]);
					renderer.previewGamutCompression = { mode: gamut, customAmount: 0.5 };
					const output = (await render(0))[0];
					for (let pixel = 0; pixel < 4; pixel++) {
						const expected = compressedReference(Array.from(primaries.slice(pixel * 4, pixel * 4 + 3)), gamut, 0.5);
						for (let channel = 0; channel < 3; channel++) {
							const encoded = Math.max(0, Math.min(1, linearChannelToSrgb(expected[channel]))) * 255;
							if (Math.abs(output[pixel * 4 + channel] - encoded) > 3) throw new Error(`${mode} ${gamut} primary ${pixel} channel ${channel}: ${output[pixel * 4 + channel]} != ${encoded}`);
						}
					}
					checks.push(`${mode} ${gamut} primaries and white`);
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
				renderer.previewGamutCompression = { mode: 'none', customAmount: 0.5 };
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
				// 圧縮は背景合成後に一度だけ行い、alpha=0の発光にも同じ表示変換を使う。
				renderer.previewGamutCompression = { mode: 'custom', customAmount: 0.5 };
				const compressedEmission = (await render(-1))[0];
				const expectedEmission = compressedReference([0.25, 0.125, 0], 'custom', 0.5);
				for (let channel = 0; channel < 3; channel++) {
					if (Math.abs(compressedEmission[channel] - linearChannelToSrgb(expectedEmission[channel]) * 255) > 2) throw new Error(`${mode}: zero-alpha emission compression failed`);
				}
				checks.push(`${mode} compresses composed zero-alpha emission`);
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
