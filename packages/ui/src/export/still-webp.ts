import encode, { init } from '@jsquash/webp/encode.js';
import encoderUrl from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import simdEncoderUrl from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';
import { getWebpOptions } from './webp-options.ts';
import type { StillExportSettings } from './timeline-export.ts';

export async function encodeStillWebp(canvas: OffscreenCanvas, settings: StillExportSettings): Promise<ArrayBuffer> {
	// WASMのロードを待つ前に描画結果をコピーする。WebGPUのCanvasの有効期間を越えて読まない。
	const copy = new OffscreenCanvas(canvas.width, canvas.height);
	const context = copy.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Could not read the rendered image.');
	context.drawImage(canvas, 0, 0);
	// getImageDataは未乗算のRGBAを返すため、libwebpへ渡す前の追加unpremultiplyは不要。
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
	// ViteがWASMを配布物に含め、アプリのbase URLに沿った場所から読み込めるよう明示する。
	await init({ locateFile: (path: string) => path.endsWith('webp_enc_simd.wasm') ? simdEncoderUrl : encoderUrl });
	return encode(pixels, getWebpOptions(settings.quality));
}
