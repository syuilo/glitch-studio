import type { ExportRequest, ExportResponse, ExportChunkAcknowledgement } from './types.ts';
import type { ExportProgress } from './timeline-export.ts';

export function exportTimeline(request: ExportRequest, signal: AbortSignal, onProgress: (progress: ExportProgress) => void,
	writeChunk: (chunk: Uint8Array<ArrayBuffer>, totalBytes: number | null, position: number) => Promise<void>): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		signal.throwIfAborted();
		const worker = new Worker(new URL('./timeline-export.worker.ts', import.meta.url), { type: 'module' });
		let settled = false;
		let writtenBytes = 0;
		const dispose = () => {
			settled = true;
			worker.terminate();
			signal.removeEventListener('abort', abort);
		};
		const fail = (error: unknown) => { if (!settled) { dispose(); reject(error); } };
		const abort = () => fail(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		worker.onerror = event => fail(new Error(event.message || 'Export worker failed.'));
		worker.onmessageerror = () => fail(new Error('Could not read the export worker response.'));
		const receive = async (message: ExportResponse) => {
			if (settled) return;
			if (message.type === 'progress') onProgress(message.progress);
			else if (message.type === 'error') fail(new Error(message.message));
			else if (message.type === 'chunk') {
				const end = message.position + message.buffer.byteLength;
				if (!Number.isSafeInteger(message.position) || message.position < 0 || message.position > writtenBytes
					|| !Number.isSafeInteger(end)) throw new Error('Invalid export chunk position.');
				await writeChunk(new Uint8Array(message.buffer), message.totalBytes, message.position);
				writtenBytes = Math.max(writtenBytes, end);
				if (!settled) worker.postMessage({ type: 'chunk-written', sequence: message.sequence } satisfies ExportChunkAcknowledgement);
			} else {
				// MP4だけは一括結果を受け取る。静止画は圧縮中から保存し、完了通知に
				// ファイル全体のArrayBufferを戻さない。EXRの後書きも受信順に完了させる。
				const bytes = new Uint8Array(message.buffer);
				const chunkSize = 1024 * 1024;
				for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
					signal.throwIfAborted();
					await writeChunk(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)), bytes.byteLength, offset);
				}
				if (bytes.byteLength > 0) writtenBytes = bytes.byteLength;
				if (!Number.isSafeInteger(message.totalBytes) || message.totalBytes <= 0 || writtenBytes !== message.totalBytes) throw new Error('The export is incomplete.');
				if (!settled) { dispose(); resolve(writtenBytes); }
			}
		};
		worker.onmessage = event => { void receive(event.data).catch(fail); };
		try { worker.postMessage(request); } catch (error) { fail(error); }
	});
}
