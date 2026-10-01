import { scaleResolution } from '../resolution.ts';
import type { VideoSample } from 'mediabunny';
import type { IntermediateTextureFormat } from '../types.ts';

/** 動画の表示寸法に指定倍率を適用してGPUへ転送する。fitやレイヤーの変形は呼び出し側で行う。 */
export function createVideoTexture(device: GPUDevice, format: IntermediateTextureFormat) {
	let canvas: OffscreenCanvas | null = null;
	let texture: GPUTexture | null = null;
	return {
		upload(sample: VideoSample, resolutionScale = 1): GPUTexture {
			const { width, height } = scaleResolution({
				width: Math.max(1, Math.round(sample.displayWidth)),
				height: Math.max(1, Math.round(sample.displayHeight)),
			}, resolutionScale);
			canvas ??= new OffscreenCanvas(width, height);
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Could not create a video frame canvas.');
			context.clearRect(0, 0, width, height);
			// 回転・ピクセル比はMediabunnyのdrawで補正する。転送寸法を呼び出し側の倍率に
			// 合わせ、後段には倍率適用済みのテクスチャを渡す。倍率未指定なら原寸を維持する。
			sample.draw(context, 0, 0, width, height);
			if (!texture || texture.width !== width || texture.height !== height) {
				texture?.destroy();
				texture = device.createTexture({ size: { width, height }, format,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
			}
			// 補間前に一度だけpremultiplyし、後段ではRGBAをそのまま扱う。
			device.queue.copyExternalImageToTexture({ source: canvas }, { texture, premultipliedAlpha: true }, { width, height });
			return texture;
		},
		dispose() {
			texture?.destroy();
			texture = null;
			if (canvas) { canvas.width = 1; canvas.height = 1; }
			canvas = null;
		},
	};
}
