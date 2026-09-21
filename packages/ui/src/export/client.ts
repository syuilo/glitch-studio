import type { ExportRequest, ExportResponse } from './types.ts';
import type { ExportProgress } from './timeline-export.ts';

export function exportTimeline(request: ExportRequest, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const worker = new Worker(new URL('./timeline-export.worker.ts', import.meta.url), { type: 'module' });
		const dispose = () => {
			worker.terminate();
			signal.removeEventListener('abort', abort);
		};
		const fail = (error: unknown) => { dispose(); reject(error); };
		const abort = () => fail(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		worker.onerror = event => fail(new Error(event.message || 'Export worker failed.'));
		worker.onmessageerror = () => fail(new Error('Could not read the export worker response.'));
		worker.onmessage = (event: MessageEvent<ExportResponse>) => {
			const message = event.data;
			if (message.type === 'progress') onProgress(message.progress);
			else if (message.type === 'error') fail(new Error(message.message));
			else {
				dispose();
				resolve(message.buffer);
			}
		};
		try { worker.postMessage(request); } catch (error) { fail(error); }
	});
}
