import { OpenExrEncoder } from '@gs/subsystems_image-codec/openexr-encoder.ts';
import type { OpenExrOutputWriter } from '@gs/subsystems_image-codec/openexr-encoder.ts';
import type { ExportProgress, OpenExrStillExportSettings } from './timeline-export.ts';

export async function encodeStillOpenExr(image: {
	width: number; height: number;
	readBlocks(rowsPerBlock: number, signal: AbortSignal): AsyncIterable<Uint16Array>;
}, settings: OpenExrStillExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void,
	writeChunk: OpenExrOutputWriter): Promise<number> {
	if (image.width !== settings.width || image.height !== settings.height) throw new Error('OpenEXR output dimensions do not match the rendered image.');
	const encoder = await OpenExrEncoder.create(settings, async (chunk, position) => {
		signal.throwIfAborted();
		await writeChunk(chunk, position);
		signal.throwIfAborted();
	});
	try {
		const totalBlocks = Math.ceil(image.height / encoder.rowsPerBlock);
		let completedBlocks = 0;
		let lastNotification = 0;
		onProgress({ phase: 'encoding-exr', completedBlocks, totalBlocks });
		// GPU読み戻しと圧縮を順に進める。画像全体のCPU配列やfloat32の複製を持たず、
		// ここでの進捗は「取得と圧縮の両方を完了したブロック数」を表す。
		for await (const pixels of image.readBlocks(encoder.rowsPerBlock, signal)) {
			signal.throwIfAborted();
			await encoder.writeBlock(pixels);
			completedBlocks++;
			const now = performance.now();
			if (now - lastNotification >= 100 || completedBlocks === totalBlocks) {
				onProgress({ phase: 'encoding-exr', completedBlocks, totalBlocks });
				lastNotification = now;
			}
		}
		signal.throwIfAborted();
		return await encoder.finish();
	} finally { encoder.dispose(); }
}
