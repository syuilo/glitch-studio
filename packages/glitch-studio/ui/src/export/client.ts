import type { ExportRequest, ExportResponse, ExportChunkAcknowledgement } from './types.ts';
import type { ExportProgress } from './timeline-export.ts';

export function exportTimeline(request: ExportRequest, signal: AbortSignal, onProgress: (progress: ExportProgress) => void,
	writeChunk: (chunk: Uint8Array<ArrayBuffer>, totalBytes: number) => Promise<void>): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		signal.throwIfAborted();
		const worker = new Worker(new URL('./timeline-export.worker.ts', import.meta.url), { type: 'module' });
		let settled = false;
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
				await writeChunk(new Uint8Array(message.buffer), message.totalBytes);
				if (!settled) worker.postMessage({ type: 'chunk-written', sequence: message.sequence } satisfies ExportChunkAcknowledgement);
			} else {
				// MP4・EXRは既存エンコーダーの一括結果を受け取るが、保存先へは同じ小さな
				// チャンクで渡す。WebPの全結果はこの経路へ戻さず、空の完了通知だけを受け取る。
				const bytes = new Uint8Array(message.buffer);
				const chunkSize = 1024 * 1024;
				for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
					signal.throwIfAborted();
					await writeChunk(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)), bytes.byteLength);
				}
				if (!settled) { dispose(); resolve(); }
			}
		};
		worker.onmessage = event => { void receive(event.data).catch(fail); };
		try { worker.postMessage(request); } catch (error) { fail(error); }
	});
}
