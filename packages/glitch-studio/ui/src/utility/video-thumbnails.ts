import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { AssetThumbnailSequence } from '../asset-thumbnail.ts';

/** 素材の映像範囲を10等分する。音声の長さやタイムラインのFPSには依存しない。 */
export async function generateVideoThumbnails(blob: Blob, onProgress: (value: number) => void = () => {}): Promise<AssetThumbnailSequence> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		onProgress(0);
		const track = await input.getPrimaryVideoTrack();
		if (track == null || !await track.canDecode()) throw new Error('Video track cannot be decoded.');
		const start = await track.getFirstTimestamp();
		const end = await track.computeDuration();
		const displayWidth = await track.getDisplayWidth();
		const displayHeight = await track.getDisplayHeight();
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
			|| !Number.isFinite(displayWidth) || !Number.isFinite(displayHeight) || displayWidth <= 0 || displayHeight <= 0) {
			throw new Error('Video has an invalid range or dimensions.');
		}
		const scale = Math.min(1, 320 / Math.max(displayWidth, displayHeight));
		const width = Math.max(1, Math.round(displayWidth * scale));
		const height = Math.max(1, Math.round(displayHeight * scale));
		const timestamps = Array.from({ length: 11 }, (_, index) => start + (end - start) * index / 10);
		// 終端指定は最後のフレームを返す。1/FPSを引く方法では可変FPSの動画を正しく扱えない。
		// Canvasを再利用するため、画像の圧縮を待ってから次のフレームを取得する。
		const sink = new CanvasSink(track, { width, height, fit: 'contain', alpha: true, poolSize: 1 });
		const frames: AssetThumbnailSequence['frames'] = [];
		let completed = 0;
		for await (const frame of sink.canvasesAtTimestamps(timestamps)) {
			// 短い動画では複数の地点が同じフレームに対応する。画像を重複して保存しない。
			if (frame != null && frames.at(-1)?.timestampSeconds !== frame.timestamp) {
				const canvas = frame.canvas;
				const fileData = canvas instanceof OffscreenCanvas
					? await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
					: await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
						if (blob == null) reject(new Error('Could not encode a thumbnail.'));
						else resolve(blob);
					}, 'image/webp', 0.8));
				frames.push({ timestampSeconds: frame.timestamp, fileData });
			}
			onProgress(++completed / timestamps.length);
		}
		if (frames.length === 0) throw new Error('Video has no thumbnail frames.');
		return { width, height, frames };
	} finally {
		input.dispose();
	}
}
