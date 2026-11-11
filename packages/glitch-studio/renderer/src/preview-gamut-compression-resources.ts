import { getPreviewGamutBoundaryLookup, PREVIEW_GAMUT_COUNT } from './preview-gamut-compression.ts';

/** プレビュー表示と解析の両方へ同じ色域境界LUTを提供し、重複したGPU確保を避ける。 */
export class PreviewGamutCompressionResources {
	private readonly fallbackBuffer: GPUBuffer;
	private lookupBuffer: GPUBuffer | null = null;

	constructor(private readonly device: GPUDevice) {
		this.fallbackBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	}

	public getBuffer(mode: number): GPUBuffer {
		if (mode > 0 && mode < PREVIEW_GAMUT_COUNT && this.lookupBuffer == null) {
			const lookup = getPreviewGamutBoundaryLookup();
			this.lookupBuffer = this.device.createBuffer({ size: lookup.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			this.device.queue.writeBuffer(this.lookupBuffer, 0, lookup);
		}
		// 既にencoderへ記録したbind groupがfallbackを参照している可能性がある。
		// LUTの初回確保で破棄せず、全ての描画が終わるdisposeまで有効にしておく。
		return this.lookupBuffer ?? this.fallbackBuffer;
	}

	public dispose() {
		this.lookupBuffer?.destroy();
		this.fallbackBuffer.destroy();
	}
}
